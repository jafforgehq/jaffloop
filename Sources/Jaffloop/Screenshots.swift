import SwiftUI
import AppKit
import JaffloopCore

/// `Jaffloop --screenshots <dir>` seeds a throwaway database and renders the README screenshots.
enum Screenshots {
    static func run(into dir: URL) {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        AppInfo.override = "0.0.4"
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("jaffloop-shots-\(UUID().uuidString).sqlite")
        guard let pool = try? openJaffloopDatabase(at: tmp) else { NSApp.terminate(nil); return }
        let store = Store(pool)
        seed(store)
        let model = AppModel(store: store, restoreState: false)
        model.snapshot = true
        let sara = model.summaries.first { $0.person.handle == "sara" }!.person
        let amir = model.summaries.first { $0.person.handle == "amir" }!.person

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
        shot("today-dark", size: NSSize(width: 1080, height: 800), main)
        shot("today-light", size: NSSize(width: 1080, height: 800), dark: false, main)
        shot("min-size", size: NSSize(width: 900, height: 560), main)
        if let first = model.today.today.first { model.selectedItemId = first.id; model.drawerItemId = first.id }
        shot("drawer", size: NSSize(width: 1180, height: 800), main)
        model.selectedItemId = nil; model.drawerItemId = nil
        model.nav = .releases
        shot("whats-new", size: NSSize(width: 1080, height: 1120), main)
        model.nav = .done
        shot("done", size: NSSize(width: 1080, height: 700), main)
        model.nav = .snoozed
        shot("snoozed", size: NSSize(width: 1080, height: 600), main)
        model.nav = .people
        UserDefaults.standard.set("grid", forKey: "peopleLayout")
        shot("people-grid", size: NSSize(width: 1080, height: 700), main)
        UserDefaults.standard.removeObject(forKey: "peopleLayout")
        model.nav = .person(sara.id)
        shot("one-on-one", size: NSSize(width: 1080, height: 720), AnyView(OneOnOneView(person: model.person(sara.id) ?? sara, onEnd: {})))
        model.nav = .person(sara.id)
        shot("person", size: NSSize(width: 1080, height: 700), main)
        model.nav = .ledger
        shot("ledger", size: NSSize(width: 1080, height: 700), main)
        model.nav = .inbox
        shot("inbox", size: NSSize(width: 1080, height: 560), main)

        shot("capture", size: NSSize(width: 700, height: 300), bg: wall,
             AnyView(CaptureView(onClose: {}, preset: "owe @sara review RFC fri #rfc !")))
        shot("capture-said", size: NSSize(width: 700, height: 300), bg: wall,
             AnyView(CaptureView(onClose: {}, preset: "said @amir \"ship date is firm for Nov 20\"")))
        shot("shortcuts", size: NSSize(width: 760, height: 520), bg: wall, AnyView(ShortcutsView()))
        shot("welcome", size: NSSize(width: 640, height: 520), bg: wall, AnyView(WelcomeView()))
        shot("menubar-popover", size: NSSize(width: 400, height: 460), AnyView(PopoverView()))
        shot("morning-brief", size: NSSize(width: 640, height: 600), AnyView(MorningBriefView()))
        shot("settings-general", size: NSSize(width: 560, height: 460), dark: false, AnyView(SettingsView(onHotkeyChange: { true }, initialTab: "general")))
        shot("settings-mcp", size: NSSize(width: 560, height: 460), dark: false, AnyView(SettingsView(onHotkeyChange: { true }, initialTab: "mcp")))

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
        func todayAt(_ h: Int) -> Date { day(0, hour: min(23, max(h, cal.component(.hour, from: now) + 1))) }
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
        add(.owe, "Share Q4 roadmap outline", jonas, due: todayAt(16), time: true, created: 2)
        add(.task, "Prepare Q4 plan", nil, due: day(1), created: 5, snoozes: 3, tags: ["planning"])
        add(.task, "1:1 prep", nil, due: todayAt(9), time: true, created: 7, pinned: true)
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
        // finished, dropped and snoozed items for the Done and Snoozed views
        if let d = try? store.capture("owe @amir send the onboarding doc fri") { _ = try? store.complete(d.id) }
        if let d = try? store.capture("wait @maya security review sign-off") { _ = try? store.complete(d.id) }
        if let d = try? store.capture("todo renew the monitoring contract") { try? store.drop(d.id) }
        if let d = try? store.capture("bring @sara conference budget") { try? store.snooze(d.id, until: Date().addingTimeInterval(3 * 86400)) }
        if let d = try? store.capture("owe @jonas security audit summary") { try? store.snooze(d.id, until: Date().addingTimeInterval(26 * 3600)) }
        var notes = sara; notes.notes = "Prefers async updates. Wants a staff promotion case ready for the Q1 cycle."; try? store.savePerson(notes)
        _ = jonas
    }
}
