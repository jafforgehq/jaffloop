import SwiftUI
import AppKit
import JaffloopCore

/// `Jaffloop --screenshots <dir>` seeds a throwaway database and renders the README screenshots.
enum Screenshots {
    static func run(into dir: URL) {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("jaffloop-shots-\(UUID().uuidString).sqlite")
        guard let pool = try? openJaffloopDatabase(at: tmp) else { NSApp.terminate(nil); return }
        let store = Store(pool)
        seed(store)
        let model = AppModel(store: store)
        model.snapshot = true
        let sara = model.summaries.first { $0.person.handle == "sara" }!.person
        let amir = model.summaries.first { $0.person.handle == "amir" }!.person
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        let event = CalEvent(id: "e1", title: "1:1 Amir / Feda", start: Date().addingTimeInterval(600), end: Date().addingTimeInterval(2400), attendeeEmails: ["amir@example.com"], attendeeNames: ["Amir"], attendeeCount: 2)
        model.meetings = [
            CalEvent(id: "m1", title: "Team standup", start: cal.date(byAdding: .hour, value: 10, to: today)!, end: cal.date(byAdding: .hour, value: 11, to: today)!, attendeeEmails: [], attendeeNames: [], attendeeCount: 9),
            CalEvent(id: "m2", title: "1:1 Sara / Feda", start: cal.date(byAdding: .hour, value: 14, to: today)!, end: cal.date(byAdding: .hour, value: 15, to: today)!, attendeeEmails: [], attendeeNames: [], attendeeCount: 2),
            event,
        ]

        let wall = NSColor(hex: 0x1B1B1A)
        func shot(_ name: String, size: NSSize, dark: Bool = true, bg: NSColor? = nil, _ view: AnyView) {
            let w = NSWindow(contentRect: NSRect(origin: NSPoint(x: 80, y: 80), size: size), styleMask: [.borderless], backing: .buffered, defer: false)
            w.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
            w.isOpaque = true
            w.backgroundColor = bg ?? NSColor(Theme.bg)
            let backed = AnyView(ZStack { Color(nsColor: bg ?? NSColor(Theme.bg)); view })
            let host = NSHostingView(rootView: backed.environmentObject(model).preferredColorScheme(dark ? .dark : .light))
            host.frame = NSRect(origin: .zero, size: size)
            w.contentView = host
            w.alphaValue = 0.01
            w.orderFrontRegardless()
            spin(1.1)
            host.layoutSubtreeIfNeeded()
            if let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) {
                rep.size = host.bounds.size
                host.cacheDisplay(in: host.bounds, to: rep)
                if let data = rep.representation(using: .png, properties: [:]) { try? data.write(to: dir.appendingPathComponent(name + ".png")) }
            }
            w.orderOut(nil)
        }

        let main = AnyView(MainView())
        model.nav = .today
        shot("today-dark", size: NSSize(width: 1080, height: 700), main)
        shot("today-light", size: NSSize(width: 1080, height: 700), dark: false, main)
        model.nav = .person(sara.id)
        shot("person", size: NSSize(width: 1080, height: 700), main)
        model.nav = .ledger
        shot("ledger", size: NSSize(width: 1080, height: 700), main)
        model.nav = .inbox
        shot("inbox", size: NSSize(width: 1080, height: 560), main)

        shot("capture", size: NSSize(width: 700, height: 220), bg: wall,
             AnyView(CaptureView(onClose: {}, preset: "owe @sara review RFC fri #rfc !")))
        shot("capture-said", size: NSSize(width: 700, height: 220), bg: wall,
             AnyView(CaptureView(onClose: {}, preset: "said @amir \"ship date is firm for Nov 20\"")))
        shot("premeeting", size: NSSize(width: 440, height: 340), bg: wall,
             AnyView(PreMeetingCard(person: amir, event: event, onOpen: {}, onDismiss: {})))
        shot("menubar-popover", size: NSSize(width: 400, height: 460), AnyView(PopoverView()))
        shot("morning-brief", size: NSSize(width: 640, height: 600), AnyView(MorningBriefView()))
        shot("settings-mcp", size: NSSize(width: 560, height: 460), dark: false, AnyView(SettingsView(calendar: CalendarService(), onHotkeyChange: {}, initialTab: "mcp")))

        try? FileManager.default.removeItem(at: tmp)
        NSApp.terminate(nil)
    }

    static func spin(_ s: TimeInterval) {
        let end = Date().addingTimeInterval(s)
        while Date() < end { RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.02)) }
    }

    static func seed(_ store: Store) {
        let now = Date()
        let cal = Calendar.current
        func day(_ off: Int, hour: Int? = nil, minute: Int = 0) -> Date {
            let d = cal.date(byAdding: .day, value: off, to: cal.startOfDay(for: now))!
            return hour.map { cal.date(bySettingHour: $0, minute: minute, second: 0, of: d)! } ?? d
        }
        func ago(_ days: Int) -> Date { cal.date(byAdding: .day, value: -days, to: now)! }
        func person(_ h: String, _ n: String, _ r: Relation, _ c: Int?, last: Int?, email: String = "") -> Person {
            let p = Person(handle: h, name: n, relation: r, cadenceDays: c, matchEmails: email)
            try? store.savePerson(p)
            if let last { _ = try? store.logInteraction(personId: p.id, at: ago(last)) }
            return p
        }
        let sara = person("sara", "Sara Lindqvist", .report, 14, last: 23, email: "sara@example.com")
        let amir = person("amir", "Amir Haddad", .report, 7, last: 5, email: "amir@example.com")
        let maya = person("maya", "Maya Chen", .peer, nil, last: 12)
        let jonas = person("jonas", "Jonas Weber", .stakeholder, 30, last: 9)
        let priya = person("priya", "Priya Nair", .report, 14, last: 6)
        _ = priya

        func add(_ k: ItemKind, _ t: String, _ p: Person? = nil, due: Date? = nil, time: Bool = false, created: Int = 1, snoozes: Int = 0, pinned: Bool = false, quote: String? = nil, inbox: Bool = false, tags: [String] = []) {
            var i = Item(kind: k, title: t, quote: quote, personId: p?.id, dueAt: due, dueHasTime: time, snoozeCount: snoozes, pinned: pinned, inbox: inbox, source: .hotkey, now: ago(created))
            i.lastTouchedAt = ago(created)
            try? store.insert(i, tags: tags)
        }
        add(.owe, "Review RFC for the on-call rotation", sara, due: day(-2), created: 6, tags: ["rfc"])
        add(.owe, "Send promotion timeline draft", sara, due: day(2), created: 3)
        add(.owe, "Approve headcount request", amir, due: day(0), created: 4)
        add(.owe, "Intro to the platform team lead", maya, due: day(5), created: 2)
        add(.owe, "Share Q4 roadmap outline", jonas, due: day(0, hour: 16, minute: 0), time: true, created: 2)
        add(.task, "Prepare Q4 plan", nil, due: day(1), created: 5, snoozes: 3, tags: ["planning"])
        add(.task, "1:1 prep", nil, due: day(0, hour: 9, minute: 0), time: true, created: 7, pinned: true)
        add(.wait, "API spec for the billing service", amir, due: day(-5), created: 10)
        add(.wait, "Incident review notes", maya, due: day(-1), created: 4)
        add(.wait, "Vendor quote for monitoring", jonas, created: 9)
        add(.bring, "Workload and the on-call rotation", sara, created: 5)
        add(.bring, "Promotion timeline", sara, created: 5)
        add(.bring, "Conference talk proposal", amir, created: 3)
        add(.task, "Call the vendor about the invoice", nil, created: 0, inbox: true)
        add(.task, "Buy a USB-C cable", nil, created: 0, inbox: true)
        add(.said, "Headcount revisit", sara, created: 12, quote: "We'll revisit headcount in November")
        add(.said, "Ship date", amir, created: 4, quote: "Ship date is firm for Nov 20")
        add(.note, "Sara prefers async updates", sara, created: 20)
        _ = jonas
    }
}
