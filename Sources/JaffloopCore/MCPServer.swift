import Foundation
import GRDB

/// Keep in sync with VERSION in scripts/build-app.sh.
public let mcpServerVersion = "0.0.2"

/// Minimal MCP server over newline-delimited JSON-RPC (stdio). No network.
public final class MCPServer {
    let store: Store
    let iso: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f }()
    public var now: () -> Date = { Date() }
    static let writeTools: Set<String> = ["capture", "add_item", "complete_item", "snooze_item", "update_item", "log_interaction"]

    public init(store: Store) { self.store = store }

    // MARK: transport

    public func runStdio() {
        while let line = readLine(strippingNewline: true) {
            guard !line.trimmingCharacters(in: .whitespaces).isEmpty,
                  let data = line.data(using: .utf8),
                  let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
            if let resp = handle(msg), let out = try? JSONSerialization.data(withJSONObject: resp, options: [.withoutEscapingSlashes]) {
                FileHandle.standardOutput.write(out + Data("\n".utf8))
            }
        }
    }

    public func handle(_ msg: [String: Any]) -> [String: Any]? {
        let method = msg["method"] as? String ?? ""
        let id = msg["id"]
        let params = msg["params"] as? [String: Any] ?? [:]
        guard id != nil else { return nil } // notification
        func ok(_ r: Any) -> [String: Any] { ["jsonrpc": "2.0", "id": id!, "result": r] }
        func err(_ c: Int, _ m: String) -> [String: Any] { ["jsonrpc": "2.0", "id": id!, "error": ["code": c, "message": m]] }
        switch method {
        case "initialize":
            return ok(["protocolVersion": (params["protocolVersion"] as? String) ?? "2025-03-26",
                       "capabilities": ["tools": [String: Any](), "resources": [String: Any]()],
                       "serverInfo": ["name": "jaffloop", "version": mcpServerVersion]])
        case "ping": return ok([String: Any]())
        case "tools/list": return ok(["tools": Self.toolDefs])
        case "tools/call":
            let name = params["name"] as? String ?? ""
            let args = params["arguments"] as? [String: Any] ?? [:]
            return ok(callTool(name, args))
        case "resources/list":
            return ok(["resources": [
                ["uri": "jaffloop://today", "name": "Today", "mimeType": "application/json", "description": "Slipping, overdue, due today, stale waits, inbox"],
                ["uri": "jaffloop://ledger", "name": "Promise ledger", "mimeType": "application/json", "description": "All open promises grouped by person"],
            ]])
        case "resources/templates/list":
            return ok(["resourceTemplates": [["uriTemplate": "jaffloop://person/{handle}", "name": "Person", "mimeType": "application/json"]]])
        case "resources/read":
            guard let uri = params["uri"] as? String else { return err(-32602, "uri required") }
            do {
                let v = try readResource(uri)
                return ok(["contents": [["uri": uri, "mimeType": "application/json", "text": json(v)]]])
            } catch { return err(-32002, "\(error)") }
        default: return err(-32601, "method not found: \(method)")
        }
    }

    // MARK: tools

    func callTool(_ name: String, _ a: [String: Any]) -> [String: Any] {
        let wrote = Self.writeTools.contains(name)
        if wrote, store.settings().mcpReadOnly {
            store.audit(tool: name, summary: "blocked: read-only mode", wrote: false, at: now())
            return result("Jaffloop is in read-only mode for Claude. Change this in Settings > MCP.", error: true)
        }
        do {
            let (value, summary) = try run(name, a)
            store.audit(tool: name, summary: summary, wrote: wrote, at: now())
            return result(json(value))
        } catch let e as MCPError {
            store.audit(tool: name, summary: "error: \(e.message)", wrote: false, at: now())
            return result(e.message, error: true)
        } catch {
            store.audit(tool: name, summary: "error: \(error)", wrote: false, at: now())
            return result("\(error)", error: true)
        }
    }

    struct MCPError: Error { var message: String }

    func result(_ text: String, error: Bool = false) -> [String: Any] {
        var r: [String: Any] = ["content": [["type": "text", "text": text]]]
        if error { r["isError"] = true }
        return r
    }

    func json(_ v: Any) -> String {
        guard JSONSerialization.isValidJSONObject(v), let d = try? JSONSerialization.data(withJSONObject: v, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]) else { return "\(v)" }
        return String(decoding: d, as: UTF8.self)
    }

    func date(_ v: Any?) -> Date? {
        guard let s = v as? String else { return nil }
        if let d = iso.date(from: s) { return d }
        let f = DateFormatter(); f.calendar = store.calendar; f.locale = Locale(identifier: "en_US_POSIX")
        for fmt in ["yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd HH:mm", "yyyy-MM-dd"] {
            f.dateFormat = fmt
            if let d = f.date(from: s) { return d }
        }
        // allow natural phrases through the capture parser ("fri", "tomorrow 9:00")
        let p = CaptureParser.parse("todo x " + s, now: now(), calendar: store.calendar)
        return p.dueAt
    }

    func personFor(_ handle: String?) throws -> Person? {
        guard let handle else { return nil }
        let h = handle.hasPrefix("@") ? String(handle.dropFirst()) : handle
        guard let p = try store.person(handle: h, create: false) else { throw MCPError(message: "No person with handle '\(h)'.") }
        if p.hiddenFromClaude { throw MCPError(message: "No person with handle '\(h)'.") }
        return p
    }

    func visible(_ items: [Item]) -> [Item] {
        let hidden = store.hiddenPersonIds()
        return items.filter { $0.personId == nil || !hidden.contains($0.personId!) }
    }

    func dayString(_ d: Date) -> String {
        let f = DateFormatter(); f.calendar = store.calendar; f.timeZone = store.calendar.timeZone; f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }

    func itemJSON(_ i: Item, people: [String: Person]? = nil) -> [String: Any] {
        var d: [String: Any] = ["id": i.id, "kind": i.kind.rawValue, "title": i.title, "status": i.status.rawValue,
                                "pinned": i.pinned, "inbox": i.inbox, "snooze_count": i.snoozeCount,
                                "slipping": Rules.isSlipping(i), "created_at": iso.string(from: i.createdAt)]
        if let b = i.body { d["body"] = b }
        if let q = i.quote { d["quote"] = q }
        if let due = i.dueAt { d["due"] = i.dueHasTime ? iso.string(from: due) : dayString(due); d["overdue"] = Rules.isOverdue(i, now: now(), calendar: store.calendar) }
        if let r = i.remindAt { d["remind_at"] = iso.string(from: r) }
        if let s = i.snoozedUntil, s > now() { d["snoozed_until"] = iso.string(from: s) }
        if let r = i.recurRule { d["recurrence"] = r }
        if let pid = i.personId, let p = (try? store.db.read { try Person.fetchOne($0, key: pid) }) { d["person"] = p.handle }
        if let t = try? store.tags(of: i.id), !t.isEmpty { d["tags"] = t }
        if i.kind == .wait { d["stale"] = Rules.isStaleWait(i, now: now(), settings: store.settings(), calendar: store.calendar) }
        return d
    }

    func personJSON(_ s: PersonSummary) -> [String: Any] {
        var d: [String: Any] = ["handle": s.person.handle, "name": s.person.name, "relation": s.person.relation.rawValue,
                                "open_i_owe": s.openOwe, "open_they_owe": s.openWait, "cadence_overdue": s.cadenceOverdue, "archived": s.person.archived]
        if let c = s.person.cadenceDays { d["cadence_days"] = c }
        if let l = s.lastInteraction { d["last_interaction"] = iso.string(from: l) }
        if let n = s.daysSinceLast { d["days_since_last_interaction"] = n }
        return d
    }

    func run(_ name: String, _ a: [String: Any]) throws -> (Any, String) {
        let t = now()
        switch name {
        case "capture":
            guard let text = a["text"] as? String, !text.isEmpty else { throw MCPError(message: "text is required") }
            let parsed = CaptureParser.parse(text, now: t, calendar: store.calendar, eod: Settings.hm(store.settings().eodTime))
            if let h = parsed.personHandle, let p = try store.person(handle: h, create: false), p.hiddenFromClaude {
                throw MCPError(message: "No person with handle '\(h)'.")
            }
            let i = try store.create(parsed, source: .mcp, now: t)
            return (itemJSON(i), "capture: \(i.kind.rawValue) \"\(i.title)\"")
        case "add_item":
            guard let k = (a["kind"] as? String).flatMap(ItemKind.init(rawValue:)) else { throw MCPError(message: "kind must be one of owe, wait, bring, task, said, note") }
            guard let title = a["title"] as? String, !title.isEmpty else { throw MCPError(message: "title is required") }
            let p = try personFor(a["person"] as? String)
            let due = date(a["due"])
            let hasTime = (a["due"] as? String).map { $0.contains(":") } ?? false
            let tags = (a["tags"] as? [String]) ?? []
            var i = Item(kind: k, title: title, body: a["body"] as? String, quote: a["quote"] as? String, personId: p?.id,
                         dueAt: due, dueHasTime: hasTime, remindAt: date(a["remind_at"]), inbox: due == nil && p == nil && [.task, .owe, .wait, .bring].contains(k),
                         source: .mcp, now: t)
            if let r = a["recurrence"] as? String { i.recurRule = r }
            try store.insert(i, tags: tags)
            return (itemJSON(i), "add_item: \(k.rawValue) \"\(title)\"")
        case "list_items":
            var f = ItemFilter()
            if let k = a["kind"] as? String { f.kinds = [ItemKind(rawValue: k)].compactMap { $0 } }
            if let p = try personFor(a["person"] as? String) { f.personId = p.id }
            switch a["status"] as? String { case "any": f.status = nil; case let s?: f.status = ItemStatus(rawValue: s); default: f.status = .open }
            f.dueBefore = date(a["due_before"])
            f.overdueOnly = (a["overdue"] as? Bool) ?? false
            f.staleDays = a["stale_days"] as? Int
            f.includeSnoozed = true
            f.limit = (a["limit"] as? Int) ?? 50
            let items = visible(try store.items(f, now: t))
            return (["count": items.count, "items": items.map { itemJSON($0) }], "list_items: \(items.count) result(s)")
        case "get_person":
            guard let p = try personFor(a["handle"] as? String) else { throw MCPError(message: "handle is required") }
            return (try personDetail(p), "get_person: \(p.handle)")
        case "list_people":
            let hidden = store.hiddenPersonIds()
            let s = try store.personSummaries(now: t, includeArchived: (a["include_archived"] as? Bool) ?? false).filter { !hidden.contains($0.person.id) }
            return (["people": s.map(personJSON)], "list_people: \(s.count)")
        case "complete_item":
            let i = try itemFor(a["id"])
            let next = try store.complete(i.id, now: t)
            return (["completed": itemJSON(try store.item(i.id)!), "next_occurrence": next.map { itemJSON($0) } as Any], "complete_item: \"\(i.title)\"")
        case "snooze_item":
            let i = try itemFor(a["id"])
            guard let until = date(a["until"]) else { throw MCPError(message: "until must be an ISO date/time or phrase like 'tomorrow 9:00'") }
            try store.snooze(i.id, until: until, now: t)
            return (itemJSON(try store.item(i.id)!), "snooze_item: \"\(i.title)\"")
        case "update_item":
            let i = try itemFor(a["id"])
            let f = a["fields"] as? [String: Any] ?? [:]
            let pid = try personFor(f["person"] as? String)?.id
            try store.update(i.id, now: t) { it in
                if let v = f["title"] as? String { it.title = v }
                if let v = f["body"] as? String { it.body = v }
                if let v = f["quote"] as? String { it.quote = v }
                if let v = f["kind"] as? String, let k = ItemKind(rawValue: v) { it.kind = k }
                if let v = f["status"] as? String, let s = ItemStatus(rawValue: v) { it.status = s; if s == .done { it.completedAt = t } }
                if let v = f["pinned"] as? Bool { it.pinned = v }
                if let pid { it.personId = pid }
                if f["due"] != nil, let d = self.date(f["due"]) { it.dueAt = d; it.dueHasTime = (f["due"] as? String)?.contains(":") ?? false }
                if let v = f["remind_at"], let d = self.date(v) { it.remindAt = d }
            }
            if let tags = f["tags"] as? [String] { try store.setTags(i.id, tags) }
            return (itemJSON(try store.item(i.id)!), "update_item: \"\(i.title)\"")
        case "log_interaction":
            guard let p = try personFor(a["person"] as? String) else { throw MCPError(message: "person is required") }
            let kind = (a["kind"] as? String).flatMap(InteractionKind.init(rawValue:)) ?? .oneOnOne
            let x = try store.logInteraction(personId: p.id, kind: kind, notes: a["notes"] as? String, at: date(a["occurred_at"]) ?? t)
            return (["id": x.id, "person": p.handle, "occurred_at": iso.string(from: x.occurredAt)], "log_interaction: \(p.handle)")
        case "search":
            guard let q = a["query"] as? String else { throw MCPError(message: "query is required") }
            var query = q
            if let f = a["filters"] as? [String: Any] {
                if let k = f["kind"] as? String { query += " kind:\(k)" }
                if let p = f["person"] as? String { query += " @\(p.hasPrefix("@") ? String(p.dropFirst()) : p)" }
                if let b = f["before"] as? String { query += " before:\(b)" }
                if let s = f["status"] as? String { query += " status:\(s)" }
            }
            let items = visible(try store.search(query, now: t))
            return (["count": items.count, "items": items.map { itemJSON($0) }], "search: \"\(q)\" -> \(items.count)")
        case "prep_brief":
            guard let p = try personFor(a["person"] as? String) else { throw MCPError(message: "person is required") }
            return (try prepBrief(p), "prep_brief: \(p.handle)")
        case "week_summary":
            let to = date(a["to"]) ?? t
            let from = date(a["from"]) ?? (store.calendar.date(byAdding: .day, value: -7, to: to) ?? to)
            let w = try store.weekSummary(from: from, to: to, now: t)
            return (["from": iso.string(from: from), "to": iso.string(from: to),
                     "created": visible(w.created).map { itemJSON($0) }, "completed": visible(w.completed).map { itemJSON($0) },
                     "slipped": visible(w.slipped).map { itemJSON($0) }, "stale_waits": visible(w.stale).map { itemJSON($0) }],
                    "week_summary")
        default: throw MCPError(message: "unknown tool: \(name)")
        }
    }

    func itemFor(_ v: Any?) throws -> Item {
        guard let id = v as? String, let i = try store.item(id) else { throw MCPError(message: "No item with that id.") }
        if let pid = i.personId, store.hiddenPersonIds().contains(pid) { throw MCPError(message: "No item with that id.") }
        return i
    }

    func personDetail(_ p: Person) throws -> [String: Any] {
        let t = now()
        let summary = try store.personSummaries(now: t, includeArchived: true).first { $0.person.id == p.id }!
        var f = ItemFilter(); f.personId = p.id; f.includeSnoozed = true
        let open = try store.items(f, now: t)
        var sf = ItemFilter(); sf.personId = p.id; sf.kinds = [.said]; sf.status = nil; sf.limit = 20
        let said = try store.items(sf, now: t)
        let inter = try store.interactions(personId: p.id)
        var d = personJSON(summary)
        d["i_owe_them"] = open.filter { $0.kind == .owe }.map { itemJSON($0) }
        d["they_owe_me"] = open.filter { $0.kind == .wait }.map { itemJSON($0) }
        d["bring_up"] = open.filter { $0.kind == .bring }.map { itemJSON($0) }
        d["other_open"] = open.filter { [.task, .note].contains($0.kind) }.map { itemJSON($0) }
        d["said_log"] = said.map { itemJSON($0) }
        d["recent_interactions"] = inter.map { ["at": iso.string(from: $0.occurredAt), "kind": $0.kind.rawValue, "notes": $0.notes as Any] }
        return d
    }

    func prepBrief(_ p: Person) throws -> [String: Any] {
        let full = try personDetail(p)
        let keys = ["handle", "name", "relation", "last_interaction", "days_since_last_interaction", "cadence_days", "cadence_overdue",
                    "i_owe_them", "they_owe_me", "bring_up", "said_log", "recent_interactions"]
        var d = [String: Any]()
        for k in keys { if let v = full[k] { d[k] = v } }
        d["said_log"] = Array(((full["said_log"] as? [[String: Any]]) ?? []).prefix(5))
        return d
    }

    func readResource(_ uri: String) throws -> Any {
        let t = now()
        switch uri {
        case "jaffloop://today":
            let s = try store.today(now: t)
            return ["slipping": visible(s.slipping).map { itemJSON($0) }, "overdue": visible(s.overdue).map { itemJSON($0) },
                    "today": visible(s.today).map { itemJSON($0) }, "waiting_stale": visible(s.waitingStale).map { itemJSON($0) },
                    "inbox": visible(s.inbox).map { itemJSON($0) }]
        case "jaffloop://ledger":
            var f = ItemFilter(); f.kinds = [.owe]; f.includeSnoozed = true
            let items = visible(try store.items(f, now: t))
            var by: [String: [[String: Any]]] = [:]
            for i in items { let h = itemJSON(i)["person"] as? String ?? "(no person)"; by[h, default: []].append(itemJSON(i)) }
            return by
        default:
            if uri.hasPrefix("jaffloop://person/"), let p = try personFor(String(uri.dropFirst("jaffloop://person/".count))) { return try personDetail(p) }
            throw MCPError(message: "unknown resource \(uri)")
        }
    }

    // MARK: definitions

    static func tool(_ name: String, _ desc: String, _ props: [String: Any], required: [String] = []) -> [String: Any] {
        ["name": name, "description": desc, "inputSchema": ["type": "object", "properties": props, "required": required]]
    }
    static let str: [String: Any] = ["type": "string"]
    static func s(_ d: String) -> [String: Any] { ["type": "string", "description": d] }

    static let toolDefs: [[String: Any]] = [
        tool("capture", "Add an item from one line using Jaffloop capture syntax, e.g. `owe @sara review RFC fri`, `wait @amir API spec mon 10:00`, `said @sara \"quote\"`, `todo prepare plan thu #planning !`.", ["text": s("The capture line")], required: ["text"]),
        tool("add_item", "Add an item with explicit fields.", ["kind": ["type": "string", "enum": ["owe", "wait", "bring", "task", "said", "note"]], "title": str, "person": s("Person handle"), "due": s("ISO date/time, or a phrase like 'fri' or 'tomorrow 9:00'"), "remind_at": s("ISO date/time"), "tags": ["type": "array", "items": str], "quote": s("Exact words (for said)"), "body": str], required: ["kind", "title"]),
        tool("list_items", "Query items. Defaults to open items.", ["kind": str, "person": s("Person handle"), "status": s("open | done | dropped | any"), "due_before": s("ISO date/time"), "overdue": ["type": "boolean"], "stale_days": ["type": "integer", "description": "Not touched for N days"], "limit": ["type": "integer"]]),
        tool("get_person", "One person's profile, open items both ways, said log and recent interactions.", ["handle": s("Person handle")], required: ["handle"]),
        tool("list_people", "All people with cadence status.", ["include_archived": ["type": "boolean"]]),
        tool("complete_item", "Mark an item done. Recurring items create their next occurrence.", ["id": str], required: ["id"]),
        tool("snooze_item", "Hide an item until a time.", ["id": str, "until": s("ISO date/time or phrase like 'tomorrow 9:00'")], required: ["id", "until"]),
        tool("update_item", "Change fields on an item (title, body, quote, kind, status, pinned, person, due, remind_at, tags).", ["id": str, "fields": ["type": "object"]], required: ["id", "fields"]),
        tool("log_interaction", "Record a 1:1 or meeting with a person.", ["person": s("Person handle"), "kind": ["type": "string", "enum": ["1on1", "meeting", "chat", "other"]], "notes": str, "occurred_at": s("ISO date/time, defaults to now")], required: ["person"]),
        tool("search", "Full-text search over titles, bodies and quotes.", ["query": str, "filters": ["type": "object", "properties": ["kind": str, "person": str, "before": str, "status": str]]], required: ["query"]),
        tool("prep_brief", "Structured data to prepare a conversation: open items both ways, talking points, recent said entries, cadence.", ["person": s("Person handle")], required: ["person"]),
        tool("week_summary", "Created, completed, slipped and stale items for a range (defaults to the last 7 days).", ["from": s("ISO date"), "to": s("ISO date")]),
    ]
}
