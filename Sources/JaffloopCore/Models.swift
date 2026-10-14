import Foundation
import GRDB

public enum ItemKind: String, Codable, CaseIterable, DatabaseValueConvertible {
    case owe, wait, bring, task, said, note
}

public enum ItemStatus: String, Codable, DatabaseValueConvertible {
    case open, done, dropped
}

public enum ItemSource: String, Codable, DatabaseValueConvertible {
    case hotkey, mcp, meeting, `import`
}

public enum Relation: String, Codable, CaseIterable, DatabaseValueConvertible {
    case report, peer, manager, stakeholder, other
}

public enum InteractionKind: String, Codable, DatabaseValueConvertible {
    case oneOnOne = "1on1", meeting, chat, other
}

public struct Item: Codable, FetchableRecord, PersistableRecord, Identifiable, Equatable {
    public static let databaseTableName = "items"
    public var id: String
    public var kind: ItemKind
    public var title: String
    public var body: String?
    public var quote: String?
    public var personId: String?
    public var status: ItemStatus
    public var dueAt: Date?
    public var dueHasTime: Bool
    public var remindAt: Date?
    public var snoozedUntil: Date?
    public var snoozeCount: Int
    public var recurRule: String?
    public var pinned: Bool
    public var inbox: Bool
    public var source: ItemSource
    public var createdAt: Date
    public var updatedAt: Date
    public var completedAt: Date?
    public var lastTouchedAt: Date

    public init(id: String = UUID().uuidString, kind: ItemKind, title: String, body: String? = nil,
                quote: String? = nil, personId: String? = nil, status: ItemStatus = .open,
                dueAt: Date? = nil, dueHasTime: Bool = false, remindAt: Date? = nil,
                snoozedUntil: Date? = nil, snoozeCount: Int = 0, recurRule: String? = nil,
                pinned: Bool = false, inbox: Bool = false, source: ItemSource = .hotkey,
                now: Date = Date()) {
        self.id = id; self.kind = kind; self.title = title; self.body = body; self.quote = quote
        self.personId = personId; self.status = status; self.dueAt = dueAt; self.dueHasTime = dueHasTime
        self.remindAt = remindAt; self.snoozedUntil = snoozedUntil; self.snoozeCount = snoozeCount
        self.recurRule = recurRule; self.pinned = pinned; self.inbox = inbox; self.source = source
        self.createdAt = now; self.updatedAt = now; self.completedAt = nil; self.lastTouchedAt = now
    }

    public enum Columns {
        static let kind = Column("kind"), status = Column("status"), personId = Column("person_id")
        static let dueAt = Column("due_at"), inbox = Column("inbox"), snoozedUntil = Column("snoozed_until")
    }

    public static func == (a: Item, b: Item) -> Bool { a.id == b.id && a.updatedAt == b.updatedAt && a.status == b.status }
}

extension Item {
    enum CodingKeys: String, CodingKey {
        case id, kind, title, body, quote, personId = "person_id", status, dueAt = "due_at"
        case dueHasTime = "due_has_time", remindAt = "remind_at", snoozedUntil = "snoozed_until"
        case snoozeCount = "snooze_count", recurRule = "recur_rule", pinned, inbox, source
        case createdAt = "created_at", updatedAt = "updated_at", completedAt = "completed_at"
        case lastTouchedAt = "last_touched_at"
    }
}

public struct Person: Codable, FetchableRecord, PersistableRecord, Identifiable, Equatable, Hashable {
    public static let databaseTableName = "people"
    public var id: String
    public var handle: String
    public var name: String
    public var relation: Relation
    public var cadenceDays: Int?
    public var matchEmails: String
    public var hiddenFromClaude: Bool
    public var archived: Bool

    public init(id: String = UUID().uuidString, handle: String, name: String, relation: Relation = .other,
                cadenceDays: Int? = nil, matchEmails: String = "", hiddenFromClaude: Bool = false, archived: Bool = false) {
        self.id = id; self.handle = handle; self.name = name; self.relation = relation
        self.cadenceDays = cadenceDays; self.matchEmails = matchEmails
        self.hiddenFromClaude = hiddenFromClaude; self.archived = archived
    }

    enum CodingKeys: String, CodingKey {
        case id, handle, name, relation, cadenceDays = "cadence_days", matchEmails = "match_emails"
        case hiddenFromClaude = "hidden_from_claude", archived
    }

    public var initials: String {
        let parts = name.split(separator: " ")
        let s = parts.count > 1 ? String(parts[0].prefix(1) + parts[1].prefix(1)) : String(name.prefix(2))
        return s.uppercased()
    }

    public var emails: [String] {
        matchEmails.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).lowercased() }.filter { !$0.isEmpty }
    }
}

public struct Interaction: Codable, FetchableRecord, PersistableRecord, Identifiable {
    public static let databaseTableName = "interactions"
    public var id: String
    public var personId: String
    public var occurredAt: Date
    public var kind: InteractionKind
    public var calendarEventId: String?
    public var notes: String?

    public init(id: String = UUID().uuidString, personId: String, occurredAt: Date = Date(),
                kind: InteractionKind = .oneOnOne, calendarEventId: String? = nil, notes: String? = nil) {
        self.id = id; self.personId = personId; self.occurredAt = occurredAt; self.kind = kind
        self.calendarEventId = calendarEventId; self.notes = notes
    }

    enum CodingKeys: String, CodingKey {
        case id, personId = "person_id", occurredAt = "occurred_at", kind
        case calendarEventId = "calendar_event_id", notes
    }
}

public struct ItemEvent: Codable, FetchableRecord, PersistableRecord {
    public static let databaseTableName = "item_events"
    public var id: Int64?
    public var itemId: String
    public var at: Date
    public var event: String
    public var detail: String?

    enum CodingKeys: String, CodingKey { case id, itemId = "item_id", at, event, detail }

    public mutating func didInsert(_ inserted: InsertionSuccess) { id = inserted.rowID }
}

public struct AuditEntry: Codable, FetchableRecord, PersistableRecord, Identifiable {
    public static let databaseTableName = "mcp_audit"
    public var id: Int64?
    public var at: Date
    public var tool: String
    public var summary: String
    public var wrote: Bool

    public mutating func didInsert(_ inserted: InsertionSuccess) { id = inserted.rowID }
}
