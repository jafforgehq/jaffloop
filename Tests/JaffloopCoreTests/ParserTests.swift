import XCTest
@testable import JaffloopCore

final class ParserTests: XCTestCase {
    // Wednesday 2026-10-14 10:00 UTC
    var cal: Calendar = { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!; c.firstWeekday = 2; return c }()
    lazy var now: Date = cal.date(from: DateComponents(year: 2026, month: 10, day: 14, hour: 10))!

    func p(_ s: String) -> ParsedCapture { CaptureParser.parse(s, now: now, calendar: cal) }
    func d(_ y: Int, _ m: Int, _ d: Int, _ h: Int? = nil, _ mi: Int = 0) -> Date {
        cal.date(from: DateComponents(year: y, month: m, day: d, hour: h ?? 0, minute: mi))!
    }

    func testOwe() {
        let r = p("owe @sara review RFC fri")
        XCTAssertEqual(r.kind, .owe); XCTAssertEqual(r.personHandle, "sara"); XCTAssertEqual(r.title, "review RFC")
        XCTAssertEqual(r.dueAt, d(2026, 10, 16)); XCTAssertFalse(r.dueHasTime)
    }
    func testWaitWithTime() {
        let r = p("wait @amir API spec mon 10:00")
        XCTAssertEqual(r.kind, .wait); XCTAssertEqual(r.personHandle, "amir"); XCTAssertEqual(r.title, "API spec")
        XCTAssertEqual(r.dueAt, d(2026, 10, 19, 10)); XCTAssertTrue(r.dueHasTime)
    }
    func testBring() {
        let r = p("bring @sara workload, promotion timeline")
        XCTAssertEqual(r.kind, .bring); XCTAssertEqual(r.title, "workload, promotion timeline"); XCTAssertNil(r.dueAt)
    }
    func testSaidQuote() {
        let r = p("said @sara \"we'll revisit headcount in Nov\"")
        XCTAssertEqual(r.kind, .said); XCTAssertEqual(r.quote, "we'll revisit headcount in Nov")
        XCTAssertNil(r.dueAt, "date words inside the quote must not be parsed")
    }
    func testTaskTagPin() {
        let r = p("todo prepare Q4 plan thu #planning !")
        XCTAssertEqual(r.kind, .task); XCTAssertEqual(r.title, "prepare Q4 plan"); XCTAssertEqual(r.tags, ["planning"])
        XCTAssertTrue(r.pinned); XCTAssertEqual(r.dueAt, d(2026, 10, 15))
    }
    func testRecurring() {
        let r = p("todo 1:1 prep every mon 09:00")
        XCTAssertEqual(r.kind, .task); XCTAssertEqual(r.title, "1:1 prep")
        XCTAssertEqual(r.recurRule, "FREQ=WEEKLY;BYDAY=MO"); XCTAssertEqual(r.dueAt, d(2026, 10, 19, 9)); XCTAssertTrue(r.dueHasTime)
    }
    func testPersonDefaultsToBring() {
        let r = p("@sara ask about on-call rotation")
        XCTAssertEqual(r.kind, .bring); XCTAssertFalse(r.kindExplicit); XCTAssertEqual(r.title, "ask about on-call rotation")
    }
    func testPlainDefaultsToTask() {
        let r = p("buy usb-c cable")
        XCTAssertEqual(r.kind, .task); XCTAssertEqual(r.title, "buy usb-c cable"); XCTAssertTrue(r.inbox)
    }
    func testShortPrefixNeedsSpace() {
        XCTAssertEqual(p("o @sara thing").kind, .owe)
        XCTAssertEqual(p("owed money").kind, .task)
        XCTAssertEqual(p("notes about x").kind, .task)
    }
    func testDates() {
        XCTAssertEqual(p("todo x today").dueAt, d(2026, 10, 14))
        XCTAssertEqual(p("todo x tomorrow").dueAt, d(2026, 10, 15))
        XCTAssertEqual(p("todo x next mon").dueAt, d(2026, 10, 19))
        XCTAssertEqual(p("todo x next fri").dueAt, d(2026, 10, 23))
        XCTAssertEqual(p("todo x 15 nov").dueAt, d(2026, 11, 15))
        XCTAssertEqual(p("todo x 1 oct").dueAt, d(2027, 10, 1), "past dates roll to next year")
        let r = p("todo x in 2h"); XCTAssertEqual(r.dueAt, now.addingTimeInterval(7200)); XCTAssertTrue(r.dueHasTime)
        let e = p("todo x eod"); XCTAssertEqual(e.dueAt, d(2026, 10, 14, 17, 30)); XCTAssertTrue(e.dueHasTime)
        let w = p("todo x eow"); XCTAssertEqual(w.dueAt, d(2026, 10, 16, 17, 30))
    }
    func testTimeOnlyIsNextOccurrence() {
        XCTAssertEqual(p("todo x 15:00").dueAt, d(2026, 10, 14, 15))
        XCTAssertEqual(p("todo x 9:00").dueAt, d(2026, 10, 15, 9))
        XCTAssertEqual(p("todo x 3pm").dueAt, d(2026, 10, 14, 15))
    }
    func testRemind() {
        let r = p("owe @sara thing fri remind 1h")
        XCTAssertEqual(r.remindAt, now.addingTimeInterval(3600)); XCTAssertEqual(r.title, "thing")
        let r2 = p("todo x remind fri 9:00"); XCTAssertEqual(r2.remindAt, d(2026, 10, 16, 9)); XCTAssertNil(r2.dueAt)
    }
    func testRecurrenceVariants() {
        XCTAssertEqual(p("todo x every 2 weeks").recurRule, "FREQ=WEEKLY;INTERVAL=2")
        XCTAssertEqual(p("todo x monthly").recurRule, "FREQ=MONTHLY")
        XCTAssertEqual(p("todo x weekdays 9:00").recurRule, "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR")
        XCTAssertEqual(p("todo x weekdays 9:00").dueAt, d(2026, 10, 15, 9))
    }
    func testSecondPersonStaysInTitle() {
        let r = p("owe @sara sync with @amir about api")
        XCTAssertEqual(r.personHandle, "sara"); XCTAssertEqual(r.title, "sync with @amir about api")
    }
    func testUnparseableStaysInTitle() {
        let r = p("todo call vendor sometime soon")
        XCTAssertEqual(r.title, "call vendor sometime soon"); XCTAssertNil(r.dueAt)
    }
    func testTokensForHighlighting() {
        let r = p("owe @sara review RFC fri #x !")
        XCTAssertEqual(r.tokens.map { $0.role }, [.kind, .person, .date, .tag, .pin])
    }
}

final class RulesTests: XCTestCase {
    var cal: Calendar = { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!; return c }()
    let now = Date(timeIntervalSince1970: 1_800_000_000)

    func testSlipping() {
        var i = Item(kind: .task, title: "x", now: now)
        XCTAssertFalse(Rules.isSlipping(i)); i.snoozeCount = 3; XCTAssertTrue(Rules.isSlipping(i))
        i.status = .done; XCTAssertFalse(Rules.isSlipping(i))
    }
    func testStaleWaitDated() {
        let due = now.addingTimeInterval(-4 * 86400)
        var i = Item(kind: .wait, title: "x", dueAt: due, now: now.addingTimeInterval(-10 * 86400))
        XCTAssertTrue(Rules.isStaleWait(i, now: now, calendar: cal))
        i.lastTouchedAt = now.addingTimeInterval(-3600)
        XCTAssertFalse(Rules.isStaleWait(i, now: now, calendar: cal), "recent touch clears staleness")
        let fresh = Item(kind: .wait, title: "x", dueAt: now.addingTimeInterval(-86400), now: now.addingTimeInterval(-10 * 86400))
        XCTAssertFalse(Rules.isStaleWait(fresh, now: now, calendar: cal), "only 1 day past due")
    }
    func testStaleWaitUndated() {
        XCTAssertTrue(Rules.isStaleWait(Item(kind: .wait, title: "x", now: now.addingTimeInterval(-6 * 86400)), now: now, calendar: cal))
        XCTAssertFalse(Rules.isStaleWait(Item(kind: .wait, title: "x", now: now.addingTimeInterval(-2 * 86400)), now: now, calendar: cal))
        XCTAssertFalse(Rules.isStaleWait(Item(kind: .owe, title: "x", now: now.addingTimeInterval(-9 * 86400)), now: now, calendar: cal))
    }
    func testCadence() {
        XCTAssertTrue(Rules.cadenceOverdue(cadenceDays: 14, lastInteraction: now.addingTimeInterval(-23 * 86400), now: now, calendar: cal))
        XCTAssertFalse(Rules.cadenceOverdue(cadenceDays: 14, lastInteraction: now.addingTimeInterval(-3 * 86400), now: now, calendar: cal))
        XCTAssertFalse(Rules.cadenceOverdue(cadenceDays: nil, lastInteraction: nil, now: now, calendar: cal))
    }
}

final class StoreTests: XCTestCase {
    var store: Store!
    override func setUpWithError() throws { store = Store(try openInMemoryDatabase()) }

    func testCaptureCreatesPersonAndItem() throws {
        let i = try store.capture("owe @sara review RFC fri #rfc")
        XCTAssertEqual(try store.people().map { $0.handle }, ["sara"])
        XCTAssertEqual(i.personId, try store.person(handle: "sara")?.id)
        XCTAssertEqual(try store.tags(of: i.id), ["rfc"])
        XCTAssertFalse(i.inbox)
    }
    func testInboxClearsWhenAssigned() throws {
        let i = try store.capture("buy cable")
        XCTAssertTrue(i.inbox)
        try store.assign(i.id, personHandle: nil, due: Date().addingTimeInterval(86400))
        XCTAssertFalse(try store.item(i.id)!.inbox)
    }
    func testSnoozeThreeTimesSlips() throws {
        let i = try store.capture("todo x today")
        for _ in 0..<3 { try store.snooze(i.id, until: Date().addingTimeInterval(-1)) }
        XCTAssertTrue(Rules.isSlipping(try store.item(i.id)!))
        XCTAssertEqual(try store.today().slipping.count, 1)
    }
    func testRecurringCompleteSpawnsNext() throws {
        let now = Date()
        let i = try store.capture("todo standup every day", now: now)
        let next = try store.complete(i.id, now: now)
        XCTAssertNotNil(next); XCTAssertEqual(try store.item(i.id)!.status, .done)
        XCTAssertGreaterThan(next!.dueAt!, now)
    }
    func testSearchFilters() throws {
        try store.capture("owe @sara review RFC")
        try store.capture("wait @amir API spec")
        XCTAssertEqual(try store.search("RFC").count, 1)
        XCTAssertEqual(try store.search("@amir").count, 1)
        XCTAssertEqual(try store.search("kind:owe").count, 1)
        XCTAssertEqual(try store.search("rev").count, 1, "prefix match")
    }
    func testHiddenPeople() throws {
        try store.capture("owe @sara x")
        var p = try store.person(handle: "sara")!; p.hiddenFromClaude = true; try store.savePerson(p)
        XCTAssertEqual(store.hiddenPersonIds(), [p.id])
    }
    func testSettingsRoundTrip() throws {
        var s = store.settings(); s.mcpReadOnly = true; s.eodTime = "16:00"; try store.saveSettings(s)
        XCTAssertTrue(store.settings().mcpReadOnly); XCTAssertEqual(store.settings().eodTime, "16:00")
    }
}

final class MCPTests: XCTestCase {
    var server: MCPServer!, store: Store!
    override func setUpWithError() throws { store = Store(try openInMemoryDatabase()); server = MCPServer(store: store) }

    func call(_ tool: String, _ args: [String: Any]) -> (String, Bool) {
        let r = server.handle(["jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": ["name": tool, "arguments": args]])!
        let res = r["result"] as! [String: Any]
        let text = ((res["content"] as! [[String: Any]])[0]["text"] as! String)
        return (text, res["isError"] as? Bool ?? false)
    }

    func testCaptureListAndSource() throws {
        let (_, e) = call("capture", ["text": "owe @sara review RFC fri"]); XCTAssertFalse(e)
        let (t, _) = call("list_items", ["person": "sara"])
        XCTAssertTrue(t.contains("review RFC"))
        XCTAssertEqual(try store.items().first?.source, .mcp)
        XCTAssertEqual(store.auditLog().count, 2)
    }
    func testDateOnlyDueIsLocalDay() throws {
        let i = try store.capture("owe @sara x fri")
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = store.calendar.timeZone
        XCTAssertTrue(call("list_items", [:]).0.contains("\"due\" : \"\(f.string(from: i.dueAt!))\""))
    }
    func testReadOnlyBlocksWrites() throws {
        var s = store.settings(); s.mcpReadOnly = true; try store.saveSettings(s)
        XCTAssertTrue(call("capture", ["text": "todo x"]).1)
        XCTAssertEqual(try store.items().count, 0)
        XCTAssertFalse(call("list_items", [:]).1, "reads still work")
    }
    func testHiddenPersonInvisible() throws {
        try store.capture("owe @sara secret")
        try store.capture("owe @amir visible")
        var p = try store.person(handle: "sara")!; p.hiddenFromClaude = true; try store.savePerson(p)
        let (t, _) = call("list_items", [:]); XCTAssertFalse(t.contains("secret")); XCTAssertTrue(t.contains("visible"))
        XCTAssertFalse(call("search", ["query": "secret"]).0.contains("secret"))
        XCTAssertTrue(call("get_person", ["handle": "sara"]).1)
        XCTAssertFalse(call("list_people", [:]).0.contains("sara"))
        XCTAssertTrue(call("capture", ["text": "owe @sara x"]).1)
    }
    func testCompleteAndPrep() throws {
        let i = try store.capture("owe @sara thing fri")
        XCTAssertFalse(call("complete_item", ["id": i.id]).1)
        XCTAssertEqual(try store.item(i.id)?.status, .done)
        try store.capture("bring @sara workload")
        XCTAssertTrue(call("prep_brief", ["person": "sara"]).0.contains("workload"))
    }
    func testInitializeAndList() {
        let r = server.handle(["jsonrpc": "2.0", "id": 1, "method": "initialize", "params": [:]])!
        XCTAssertNotNil((r["result"] as? [String: Any])?["serverInfo"])
        let l = server.handle(["jsonrpc": "2.0", "id": 2, "method": "tools/list"])!
        XCTAssertEqual(((l["result"] as! [String: Any])["tools"] as! [Any]).count, 12)
        XCTAssertNil(server.handle(["jsonrpc": "2.0", "method": "notifications/initialized"]))
    }
}


final class HelperTests: XCTestCase {
    var cal: Calendar = { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!; c.firstWeekday = 2; return c }()
    let now = Date(timeIntervalSince1970: 1_800_000_000)

    func testVersionCompare() {
        XCTAssertTrue(AppVersion("0.0.3")! > AppVersion("0.0.2")!)
        XCTAssertTrue(AppVersion("v0.1")! > AppVersion("0.0.9")!)
        XCTAssertEqual(AppVersion("1.0")!, AppVersion("1.0.0")!)
        XCTAssertNil(AppVersion("dev"))
        XCTAssertEqual(AppVersion("v0.0.3")!.description, "0.0.3")
    }
    func testLocalizedClock() {
        XCTAssertTrue(TimeFormat.localize("HH:mm", locale: Locale(identifier: "en_US")).contains("a"))
        XCTAssertTrue(TimeFormat.localize("HH:mm", locale: Locale(identifier: "en_GB")).contains("HH"))
        XCTAssertEqual(TimeFormat.localize("EEE", locale: Locale(identifier: "en_US")), "EEE", "no time part, unchanged")
    }
    func summary(_ name: String, cadence: Int?, days: Int?, overdue: Bool) -> PersonSummary {
        PersonSummary(person: Person(handle: name.lowercased(), name: name, cadenceDays: cadence), lastInteraction: nil,
                      openOwe: 0, openWait: 0, daysSinceLast: days, cadenceOverdue: overdue)
    }
    func testPeopleOrder() {
        let a = summary("Amir", cadence: 7, days: 3, overdue: false)
        let b = summary("Bea", cadence: 14, days: 23, overdue: true)     // 9 days late
        let c = summary("Cy", cadence: 7, days: 30, overdue: true)       // 23 days late
        let d = summary("Dee", cadence: nil, days: nil, overdue: false)
        let order = PeopleOrder.sorted([a, b, c, d], pinned: [d.person.id]).map { $0.person.name }
        XCTAssertEqual(order, ["Dee", "Cy", "Bea", "Amir"])
    }
    func testCadenceStrip() {
        let w = CadenceStrip.weeks([now.addingTimeInterval(-1 * 86400), now.addingTimeInterval(-15 * 86400)], now: now, count: 4, calendar: cal)
        XCTAssertEqual(w.count, 4)
        XCTAssertTrue(w.contains(true))
        XCTAssertEqual(CadenceStrip.weeks([], now: now, count: 3, calendar: cal), [false, false, false])
    }
    func testAgeBadge() {
        let old = Item(kind: .wait, title: "x", now: now.addingTimeInterval(-12 * 86400))
        XCTAssertEqual(ItemAge.badge(old, now: now, calendar: cal), 12)
        XCTAssertNil(ItemAge.badge(Item(kind: .wait, title: "x", now: now.addingTimeInterval(-86400)), now: now, calendar: cal))
        XCTAssertNil(ItemAge.badge(Item(kind: .task, title: "x", now: now.addingTimeInterval(-12 * 86400)), now: now, calendar: cal))
    }
    func testRestoreUndoesDropAndSnooze() throws {
        let store = Store(try openInMemoryDatabase())
        let i = try store.capture("owe @sara x fri")
        let before = try store.item(i.id)!
        try store.drop(i.id); XCTAssertEqual(try store.item(i.id)!.status, .dropped)
        try store.restore(before); XCTAssertEqual(try store.item(i.id)!.status, .open)
        try store.snooze(i.id, until: Date().addingTimeInterval(3600)); XCTAssertEqual(try store.item(i.id)!.snoozeCount, 1)
        try store.restore(before); XCTAssertEqual(try store.item(i.id)!.snoozeCount, 0)
    }
}
