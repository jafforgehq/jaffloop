import Foundation
import GRDB

// MARK: - Derived rules (pure)

public enum Rules {
    /// Snoozed 3+ times and still open.
    public static func isSlipping(_ i: Item) -> Bool { i.status == .open && i.snoozeCount >= 3 }

    /// Waiting-on with no touch for N days past due (or N days since creation when undated).
    public static func isStaleWait(_ i: Item, now: Date, settings: Settings = Settings(), calendar: Calendar = .current) -> Bool {
        guard i.kind == .wait, i.status == .open else { return false }
        if let due = i.dueAt {
            let limit = calendar.date(byAdding: .day, value: settings.staleDaysAfterDue, to: due) ?? due
            return now >= limit && i.lastTouchedAt <= limit
        }
        let limit = calendar.date(byAdding: .day, value: settings.staleDaysNoDue, to: i.createdAt) ?? i.createdAt
        return now >= limit && i.lastTouchedAt < limit
    }

    public static func isOverdue(_ i: Item, now: Date, calendar: Calendar = .current) -> Bool {
        guard i.status == .open, let due = i.dueAt else { return false }
        return i.dueHasTime ? due < now : due < calendar.startOfDay(for: now)
    }

    public static func isHidden(_ i: Item, now: Date) -> Bool {
        if let s = i.snoozedUntil, s > now { return true }
        return false
    }

    /// Days since the last interaction exceed the cadence.
    public static func daysSince(_ last: Date?, now: Date, calendar: Calendar = .current) -> Int? {
        guard let last else { return nil }
        return calendar.dateComponents([.day], from: calendar.startOfDay(for: last), to: calendar.startOfDay(for: now)).day
    }

    public static func cadenceOverdue(cadenceDays: Int?, lastInteraction: Date?, now: Date, calendar: Calendar = .current) -> Bool {
        guard let c = cadenceDays, let d = daysSince(lastInteraction, now: now, calendar: calendar) else { return false }
        return d > c
    }
}

// MARK: - Query helpers

public struct ItemFilter {
    public var kinds: [ItemKind]?
    public var personId: String?
    public var status: ItemStatus? = .open
    public var dueBefore: Date?
    public var overdueOnly = false
    public var staleDays: Int?
    public var tag: String?
    public var inboxOnly = false
    public var includeSnoozed = false
    public var limit: Int?
    public init() {}
}

public struct PersonSummary: Identifiable {
    public var person: Person
    public var lastInteraction: Date?
    public var openOwe: Int
    public var openWait: Int
    public var daysSinceLast: Int?
    public var cadenceOverdue: Bool
    public var id: String { person.id }
}

public struct TodaySections {
    public var slipping: [Item] = [], overdue: [Item] = [], today: [Item] = []
    public var waitingStale: [Item] = [], inbox: [Item] = []
    public var checkIn: [PersonSummary] = []
    public init() {}
    public var total: Int { slipping.count + overdue.count + today.count + waitingStale.count + inbox.count }
}

// MARK: - Store

/// All reads and writes go through here, for both the app and the MCP server.
public final class Store {
    public let db: DatabaseWriter
    public var calendar: Calendar = .current

    public init(_ db: DatabaseWriter) { self.db = db }

    public func settings() -> Settings { (try? db.read { try Settings.load($0) }) ?? Settings() }
    public func saveSettings(_ s: Settings) throws { try db.write { try s.save($0) } }

    // People

    @discardableResult
    public func person(handle: String, create: Bool = true) throws -> Person? {
        let h = handle.lowercased()
        return try db.write { db in
            if let p = try Person.filter(Column("handle") == h).fetchOne(db) { return p }
            guard create else { return nil }
            let name = h.split(whereSeparator: { "._-".contains($0) }).map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: " ")
            let p = Person(handle: h, name: name)
            try p.insert(db)
            return p
        }
    }

    public func people(includeArchived: Bool = false) throws -> [Person] {
        try db.read { db in
            var r = Person.order(Column("name").collating(.nocase))
            if !includeArchived { r = r.filter(Column("archived") == false) }
            return try r.fetchAll(db)
        }
    }

    public func savePerson(_ p: Person) throws { try db.write { try p.save($0) } }

    public func personSummaries(now: Date = Date(), includeArchived: Bool = false) throws -> [PersonSummary] {
        try db.read { db in
            var r = Person.order(Column("name").collating(.nocase))
            if !includeArchived { r = r.filter(Column("archived") == false) }
            return try r.fetchAll(db).map { p in
                let last = try Date.fetchOne(db, sql: "SELECT MAX(occurred_at) FROM interactions WHERE person_id=?", arguments: [p.id])
                let owe = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM items WHERE person_id=? AND kind='owe' AND status='open'", arguments: [p.id]) ?? 0
                let wait = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM items WHERE person_id=? AND kind='wait' AND status='open'", arguments: [p.id]) ?? 0
                return PersonSummary(person: p, lastInteraction: last, openOwe: owe, openWait: wait,
                                     daysSinceLast: Rules.daysSince(last, now: now, calendar: calendar),
                                     cadenceOverdue: Rules.cadenceOverdue(cadenceDays: p.cadenceDays, lastInteraction: last, now: now, calendar: calendar))
            }
        }
    }

    public func hiddenPersonIds() -> Set<String> {
        Set((try? db.read { try String.fetchAll($0, sql: "SELECT id FROM people WHERE hidden_from_claude=1") }) ?? [])
    }

    // Items

    @discardableResult
    public func create(_ p: ParsedCapture, source: ItemSource = .hotkey, now: Date = Date()) throws -> Item {
        let person = try p.personHandle.flatMap { try person(handle: $0) }
        var item = Item(kind: p.kind, title: p.title.isEmpty ? "Untitled" : p.title, quote: p.quote,
                        personId: person?.id, dueAt: p.dueAt, dueHasTime: p.dueHasTime, remindAt: p.remindAt,
                        recurRule: p.recurRule, pinned: p.pinned, inbox: p.inbox, source: source, now: now)
        if item.kind == .said || item.kind == .note { item.inbox = false }
        try db.write { db in
            try item.insert(db)
            for t in p.tags { try db.execute(sql: "INSERT OR IGNORE INTO item_tags(item_id, tag) VALUES(?,?)", arguments: [item.id, t]) }
            try ItemEvent(id: nil, itemId: item.id, at: now, event: "created", detail: source.rawValue).insert(db)
        }
        return item
    }

    /// Parse one line and save it. Used by the app, the MCP `capture` tool and tests.
    @discardableResult
    public func capture(_ line: String, source: ItemSource = .hotkey, now: Date = Date()) throws -> Item {
        let s = settings()
        let p = CaptureParser.parse(line, now: now, calendar: calendar, eod: Settings.hm(s.eodTime))
        return try create(p, source: source, now: now)
    }

    public func insert(_ item: Item, tags: [String] = []) throws {
        try db.write { db in
            try item.insert(db)
            for t in tags { try db.execute(sql: "INSERT OR IGNORE INTO item_tags(item_id, tag) VALUES(?,?)", arguments: [item.id, t.lowercased()]) }
            try ItemEvent(id: nil, itemId: item.id, at: item.createdAt, event: "created", detail: item.source.rawValue).insert(db)
        }
    }

    public func item(_ id: String) throws -> Item? { try db.read { try Item.fetchOne($0, key: id) } }

    public func tags(of id: String) throws -> [String] {
        try db.read { try String.fetchAll($0, sql: "SELECT tag FROM item_tags WHERE item_id=? ORDER BY tag", arguments: [id]) }
    }

    public func allTags() throws -> [(String, Int)] {
        try db.read { db in
            try Row.fetchAll(db, sql: "SELECT tag, COUNT(*) c FROM item_tags JOIN items ON items.id=item_id WHERE status='open' GROUP BY tag ORDER BY tag")
                .map { ($0["tag"], $0["c"]) }
        }
    }

    public func items(_ f: ItemFilter = ItemFilter(), now: Date = Date()) throws -> [Item] {
        try db.read { db in
            var r = Item.all()
            if let k = f.kinds { r = r.filter(k.map { $0.rawValue }.contains(Column("kind"))) }
            if let p = f.personId { r = r.filter(Column("person_id") == p) }
            if let s = f.status { r = r.filter(Column("status") == s.rawValue) }
            if let d = f.dueBefore { r = r.filter(Column("due_at") != nil && Column("due_at") < d) }
            if f.inboxOnly { r = r.filter(Column("inbox") == true) }
            if let t = f.tag { r = r.filter(sql: "id IN (SELECT item_id FROM item_tags WHERE tag = ?)", arguments: [t]) }
            if !f.includeSnoozed { r = r.filter(Column("snoozed_until") == nil || Column("snoozed_until") <= now) }
            r = r.order(sql: "pinned DESC, due_at IS NULL, due_at ASC, created_at DESC")
            var out = try r.fetchAll(db)
            if f.overdueOnly { out = out.filter { Rules.isOverdue($0, now: now, calendar: calendar) } }
            if let sd = f.staleDays {
                let cutoff = calendar.date(byAdding: .day, value: -sd, to: now) ?? now
                out = out.filter { $0.lastTouchedAt < cutoff }
            }
            if let l = f.limit { out = Array(out.prefix(l)) }
            return out
        }
    }

    public func update(_ id: String, now: Date = Date(), _ change: (inout Item) -> Void) throws {
        try db.write { db in
            guard var i = try Item.fetchOne(db, key: id) else { return }
            change(&i)
            i.updatedAt = now; i.lastTouchedAt = now
            if i.dueAt != nil || i.personId != nil { i.inbox = false }
            try i.update(db)
        }
    }

    /// Completes an item. A recurring item spawns its next occurrence.
    @discardableResult
    public func complete(_ id: String, now: Date = Date()) throws -> Item? {
        try db.write { db in
            guard var i = try Item.fetchOne(db, key: id), i.status == .open else { return nil }
            i.status = .done; i.completedAt = now; i.updatedAt = now; i.lastTouchedAt = now
            try i.update(db)
            try ItemEvent(id: nil, itemId: id, at: now, event: "completed", detail: nil).insert(db)
            guard let rule = i.recurRule, !rule.isEmpty else { return nil }
            let base = i.dueAt ?? now
            guard let nextDue = Recurrence.nextFuture(from: base, rule: rule, now: now, calendar: calendar) else { return nil }
            var n = Item(kind: i.kind, title: i.title, body: i.body, quote: nil, personId: i.personId, dueAt: nextDue,
                         dueHasTime: i.dueHasTime, recurRule: rule, pinned: i.pinned, inbox: false, source: i.source, now: now)
            if let r = i.remindAt, let d = i.dueAt { n.remindAt = nextDue.addingTimeInterval(r.timeIntervalSince(d)) }
            try n.insert(db)
            try db.execute(sql: "INSERT INTO item_tags(item_id, tag) SELECT ?, tag FROM item_tags WHERE item_id=?", arguments: [n.id, id])
            try ItemEvent(id: nil, itemId: n.id, at: now, event: "created", detail: "recurrence").insert(db)
            return n
        }
    }

    public func drop(_ id: String, now: Date = Date()) throws {
        try db.write { db in
            guard var i = try Item.fetchOne(db, key: id) else { return }
            i.status = .dropped; i.updatedAt = now; i.lastTouchedAt = now; i.inbox = false
            try i.update(db)
            try ItemEvent(id: nil, itemId: id, at: now, event: "dropped", detail: nil).insert(db)
        }
    }

    /// Finished or dropped items, newest first.
    public func history(since: Date?, limit: Int = 500) throws -> [Item] {
        try db.read { db in
            var r = Item.filter(Column("status") != "open")
            if let since { r = r.filter(Column("updated_at") >= since) }
            return try r.order(Column("updated_at").desc).limit(limit).fetchAll(db)
        }
    }

    /// Open items hidden until a later time, soonest wake-up first.
    public func snoozed(now: Date = Date()) throws -> [Item] {
        try db.read { db in
            try Item.filter(Column("status") == "open").filter(Column("snoozed_until") != nil && Column("snoozed_until") > now)
                .order(Column("snoozed_until").asc).fetchAll(db)
        }
    }

    /// Writes an earlier copy of an item back unchanged (undo). Keeps its original timestamps.
    public func restore(_ item: Item) throws { try db.write { try item.update($0) } }

    public func reopen(_ id: String, now: Date = Date()) throws {
        try update(id, now: now) { $0.status = .open; $0.completedAt = nil }
    }

    public func snooze(_ id: String, until: Date, now: Date = Date()) throws {
        try db.write { db in
            guard var i = try Item.fetchOne(db, key: id) else { return }
            i.snoozedUntil = until; i.snoozeCount += 1; i.updatedAt = now; i.lastTouchedAt = now
            try i.update(db)
            try ItemEvent(id: nil, itemId: id, at: now, event: "snoozed", detail: ISO8601DateFormatter().string(from: until)).insert(db)
        }
    }

    public func assign(_ id: String, personHandle: String?, due: Date?, hasTime: Bool = false) throws {
        let pid = try personHandle.flatMap { try person(handle: $0) }?.id
        try update(id) { i in
            if let pid { i.personId = pid }
            if let due { i.dueAt = due; i.dueHasTime = hasTime }
        }
    }

    public func setTags(_ id: String, _ tags: [String]) throws {
        try db.write { db in
            try db.execute(sql: "DELETE FROM item_tags WHERE item_id=?", arguments: [id])
            for t in tags { try db.execute(sql: "INSERT OR IGNORE INTO item_tags(item_id, tag) VALUES(?,?)", arguments: [id, t.lowercased()]) }
        }
    }

    // Interactions

    @discardableResult
    public func logInteraction(personId: String, kind: InteractionKind = .oneOnOne, notes: String? = nil,
                               at: Date = Date(), eventId: String? = nil) throws -> Interaction {
        let x = Interaction(personId: personId, occurredAt: at, kind: kind, calendarEventId: eventId, notes: notes)
        try db.write { try x.insert($0) }
        return x
    }

    public func interactions(personId: String, limit: Int = 10) throws -> [Interaction] {
        try db.read { try Interaction.filter(Column("person_id") == personId).order(Column("occurred_at").desc).limit(limit).fetchAll($0) }
    }

    // Search

    /// FTS5 search. Filters: `@person`, `kind:owe`, `before:2026-11-01`, `status:done`.
    public func search(_ query: String, limit: Int = 50, now: Date = Date()) throws -> [Item] {
        var words: [String] = []
        var f = ItemFilter(); f.status = nil; f.includeSnoozed = true
        for tok in query.split(separator: " ").map(String.init) {
            if tok.hasPrefix("@"), tok.count > 1 {
                if let p = try person(handle: String(tok.dropFirst()), create: false) { f.personId = p.id } else { return [] }
            } else if tok.lowercased().hasPrefix("kind:"), let k = ItemKind(rawValue: String(tok.dropFirst(5)).lowercased()) { f.kinds = [k] }
            else if tok.lowercased().hasPrefix("status:"), let s = ItemStatus(rawValue: String(tok.dropFirst(7)).lowercased()) { f.status = s }
            else if tok.lowercased().hasPrefix("before:") {
                let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"; df.calendar = calendar
                f.dueBefore = df.date(from: String(tok.dropFirst(7)))
            } else { words.append(tok) }
        }
        let fts = words.map { w -> String in
            let clean = w.replacingOccurrences(of: "\"", with: "")
            return "\"\(clean)\"*"
        }.joined(separator: " ")
        return try db.read { db in
            var r: QueryInterfaceRequest<Item>
            if fts.isEmpty { r = Item.all() }
            else { r = Item.filter(sql: "rowid IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)", arguments: [fts]) }
            if let k = f.kinds { r = r.filter(k.map { $0.rawValue }.contains(Column("kind"))) }
            if let p = f.personId { r = r.filter(Column("person_id") == p) }
            if let s = f.status { r = r.filter(Column("status") == s.rawValue) }
            if let d = f.dueBefore { r = r.filter(Column("due_at") != nil && Column("due_at") < d) }
            return try r.order(Column("updated_at").desc).limit(limit).fetchAll(db)
        }
    }

    // Today

    public func today(now: Date = Date()) throws -> TodaySections {
        let s = settings()
        let open = try items(ItemFilter(), now: now)
        var t = TodaySections()
        let endOfToday = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)) ?? now
        for i in open {
            if Rules.isSlipping(i) { t.slipping.append(i); continue }
            if Rules.isOverdue(i, now: now, calendar: calendar) { t.overdue.append(i); continue }
            if i.kind == .wait, Rules.isStaleWait(i, now: now, settings: s, calendar: calendar) { t.waitingStale.append(i); continue }
            if i.inbox { t.inbox.append(i); continue }
            if let d = i.dueAt, d < endOfToday, [.owe, .task, .wait].contains(i.kind) { t.today.append(i); continue }
            if i.pinned { t.today.append(i) }
        }
        t.checkIn = try personSummaries(now: now).filter { $0.cadenceOverdue }
        return t
    }

    public func overdueCount(now: Date = Date()) -> Int {
        ((try? items(ItemFilter(), now: now)) ?? []).filter { Rules.isOverdue($0, now: now, calendar: calendar) || Rules.isSlipping($0) }.count
    }

    // Week summary

    public struct WeekSummary {
        public var created: [Item], completed: [Item], slipped: [Item], stale: [Item]
    }

    public func weekSummary(from: Date, to: Date, now: Date = Date()) throws -> WeekSummary {
        let s = settings()
        return try db.read { db in
            let created = try Item.filter(Column("created_at") >= from && Column("created_at") < to).fetchAll(db)
            let completed = try Item.filter(Column("completed_at") >= from && Column("completed_at") < to).fetchAll(db)
            let slippedIds = try String.fetchAll(db, sql: "SELECT item_id FROM item_events WHERE event='snoozed' AND at>=? AND at<? GROUP BY item_id HAVING COUNT(*)>=1", arguments: [from, to])
            let slipped = try Item.fetchAll(db, keys: slippedIds).filter { $0.snoozeCount >= 3 && $0.status == .open }
            let stale = try Item.filter(Column("kind") == "wait" && Column("status") == "open").fetchAll(db)
                .filter { Rules.isStaleWait($0, now: now, settings: s, calendar: calendar) }
            return WeekSummary(created: created, completed: completed, slipped: slipped, stale: stale)
        }
    }

    // Audit log (MCP)

    public func audit(tool: String, summary: String, wrote: Bool, at: Date = Date()) {
        try? db.write { db in
            var e = AuditEntry(id: nil, at: at, tool: tool, summary: summary, wrote: wrote)
            try e.insert(db)
            try db.execute(sql: "DELETE FROM mcp_audit WHERE id NOT IN (SELECT id FROM mcp_audit ORDER BY id DESC LIMIT 500)")
        }
    }

    public func auditLog(limit: Int = 50) -> [AuditEntry] {
        (try? db.read { try AuditEntry.order(Column("id").desc).limit(limit).fetchAll($0) }) ?? []
    }

    // Export

    public func exportJSON() throws -> Data {
        struct Dump: Encodable { var people: [Person]; var items: [Item]; var interactions: [Interaction] }
        let d = try db.read { Dump(people: try Person.fetchAll($0), items: try Item.fetchAll($0), interactions: try Interaction.fetchAll($0)) }
        let e = JSONEncoder(); e.dateEncodingStrategy = .iso8601; e.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try e.encode(d)
    }

    /// Cheap change detector for cross-process refresh.
    public func dataVersion() -> Int64 {
        (try? db.writeWithoutTransaction { try Int64.fetchOne($0, sql: "PRAGMA data_version") }) ?? 0
    }
}
