import Foundation
import GRDB

public enum JaffloopPaths {
    public static var defaultURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("Jaffloop/jaffloop.sqlite")
    }
}

/// Opens (and migrates) the shared SQLite file. WAL mode so the app and MCP server can co-write.
public func openJaffloopDatabase(at url: URL = JaffloopPaths.defaultURL) throws -> DatabasePool {
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    var config = Configuration()
    config.busyMode = .timeout(5)
    let pool = try DatabasePool(path: url.path, configuration: config)
    try migrator.migrate(pool)
    return pool
}

/// In-memory database for tests.
public func openInMemoryDatabase() throws -> DatabaseQueue {
    let q = try DatabaseQueue()
    try migrator.migrate(q)
    return q
}

var migrator: DatabaseMigrator {
    var m = DatabaseMigrator()
    m.registerMigration("v1") { db in
        try db.create(table: "people") { t in
            t.primaryKey("id", .text)
            t.column("handle", .text).notNull().unique()
            t.column("name", .text).notNull()
            t.column("relation", .text).notNull().defaults(to: "other")
            t.column("cadence_days", .integer)
            t.column("match_emails", .text).notNull().defaults(to: "")
            t.column("hidden_from_claude", .boolean).notNull().defaults(to: false)
            t.column("archived", .boolean).notNull().defaults(to: false)
        }
        try db.create(table: "items") { t in
            t.primaryKey("id", .text)
            t.column("kind", .text).notNull()
            t.column("title", .text).notNull()
            t.column("body", .text)
            t.column("quote", .text)
            t.column("person_id", .text).references("people", onDelete: .setNull)
            t.column("status", .text).notNull().defaults(to: "open")
            t.column("due_at", .datetime)
            t.column("due_has_time", .boolean).notNull().defaults(to: false)
            t.column("remind_at", .datetime)
            t.column("snoozed_until", .datetime)
            t.column("snooze_count", .integer).notNull().defaults(to: 0)
            t.column("recur_rule", .text)
            t.column("pinned", .boolean).notNull().defaults(to: false)
            t.column("inbox", .boolean).notNull().defaults(to: false)
            t.column("source", .text).notNull().defaults(to: "hotkey")
            t.column("created_at", .datetime).notNull()
            t.column("updated_at", .datetime).notNull()
            t.column("completed_at", .datetime)
            t.column("last_touched_at", .datetime).notNull()
        }
        try db.create(index: "items_person", on: "items", columns: ["person_id"])
        try db.create(index: "items_status_due", on: "items", columns: ["status", "due_at"])
        try db.create(table: "interactions") { t in
            t.primaryKey("id", .text)
            t.column("person_id", .text).notNull().references("people", onDelete: .cascade)
            t.column("occurred_at", .datetime).notNull()
            t.column("kind", .text).notNull()
            t.column("calendar_event_id", .text)
            t.column("notes", .text)
        }
        try db.create(table: "item_tags") { t in
            t.column("item_id", .text).notNull().references("items", onDelete: .cascade)
            t.column("tag", .text).notNull()
            t.primaryKey(["item_id", "tag"])
        }
        try db.create(table: "item_events") { t in
            t.autoIncrementedPrimaryKey("id")
            t.column("item_id", .text).notNull().references("items", onDelete: .cascade)
            t.column("at", .datetime).notNull()
            t.column("event", .text).notNull()
            t.column("detail", .text)
        }
        try db.create(table: "settings") { t in
            t.primaryKey("key", .text)
            t.column("value", .text).notNull()
        }
        try db.create(table: "mcp_audit") { t in
            t.autoIncrementedPrimaryKey("id")
            t.column("at", .datetime).notNull()
            t.column("tool", .text).notNull()
            t.column("summary", .text).notNull()
            t.column("wrote", .boolean).notNull().defaults(to: false)
        }
        try db.create(virtualTable: "items_fts", using: FTS5()) { t in
            t.synchronize(withTable: "items")
            t.tokenizer = .unicode61()
            t.column("title")
            t.column("body")
            t.column("quote")
        }
    }
    return m
}

/// User-tunable values, stored in the DB so the MCP server sees them too.
public struct Settings {
    public var eodTime = "17:30"
    public var workStart = "09:00"
    public var workEnd = "18:00"
    public var morningBrief = "08:30"
    public var staleDaysAfterDue = 3
    public var staleDaysNoDue = 5
    public var preMeetingMinutes = 10
    public var maxAttendees = 3
    public var calendarEnabled = false
    public var mcpReadOnly = false
    public var compact = false
    public var sound = false
    public var haptics = true
    public var hotkey = "opt+space"

    public init() {}

    public static func load(_ db: Database) throws -> Settings {
        var s = Settings()
        let rows = try Row.fetchAll(db, sql: "SELECT key, value FROM settings")
        var d: [String: String] = [:]
        for r in rows { d[r["key"]] = r["value"] }
        s.eodTime = d["eodTime"] ?? s.eodTime
        s.workStart = d["workStart"] ?? s.workStart
        s.workEnd = d["workEnd"] ?? s.workEnd
        s.morningBrief = d["morningBrief"] ?? s.morningBrief
        s.staleDaysAfterDue = d["staleDaysAfterDue"].flatMap(Int.init) ?? s.staleDaysAfterDue
        s.staleDaysNoDue = d["staleDaysNoDue"].flatMap(Int.init) ?? s.staleDaysNoDue
        s.preMeetingMinutes = d["preMeetingMinutes"].flatMap(Int.init) ?? s.preMeetingMinutes
        s.maxAttendees = d["maxAttendees"].flatMap(Int.init) ?? s.maxAttendees
        s.calendarEnabled = d["calendarEnabled"] == "1"
        s.mcpReadOnly = d["mcpReadOnly"] == "1"
        s.compact = d["compact"] == "1"
        s.sound = d["sound"] == "1"
        s.haptics = d["haptics"].map { $0 == "1" } ?? true
        s.hotkey = d["hotkey"] ?? s.hotkey
        return s
    }

    public func save(_ db: Database) throws {
        let pairs: [(String, String)] = [
            ("eodTime", eodTime), ("workStart", workStart), ("workEnd", workEnd), ("morningBrief", morningBrief),
            ("staleDaysAfterDue", String(staleDaysAfterDue)), ("staleDaysNoDue", String(staleDaysNoDue)),
            ("preMeetingMinutes", String(preMeetingMinutes)), ("maxAttendees", String(maxAttendees)),
            ("calendarEnabled", calendarEnabled ? "1" : "0"), ("mcpReadOnly", mcpReadOnly ? "1" : "0"),
            ("compact", compact ? "1" : "0"), ("sound", sound ? "1" : "0"), ("haptics", haptics ? "1" : "0"),
            ("hotkey", hotkey),
        ]
        for (k, v) in pairs {
            try db.execute(sql: "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", arguments: [k, v])
        }
    }

    /// "17:30" -> (17, 30)
    public static func hm(_ s: String) -> (Int, Int) {
        let p = s.split(separator: ":").compactMap { Int($0) }
        return (p.first ?? 0, p.count > 1 ? p[1] : 0)
    }
}
