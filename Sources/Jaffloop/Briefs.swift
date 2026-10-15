import SwiftUI
import AppKit
import JaffloopCore

// MARK: - Person brief / morning brief

struct PersonBriefView: View {
    @EnvironmentObject var model: AppModel
    let person: Person

    var body: some View {
        Page("Brief: \(person.name)", subtitle: "Before you talk") {
            ForEach([("I owe them", ItemKind.owe), ("They owe me", .wait), ("Bring up", .bring)], id: \.0) { title, k in
                let items = model.items(for: person.id, kind: k)
                SectionHeader(title: title, count: items.count)
                if items.isEmpty { Text("Nothing.").font(.system(size: 12.5)).foregroundStyle(Theme.text2).padding(8) }
                ItemList(items: items, showPerson: false)
            }
            let said = model.saidLog(for: person.id).prefix(5)
            SectionHeader(title: "Recently said", count: said.count)
            ForEach(Array(said)) { SaidRow(item: $0) }
        }
        .frame(minWidth: 560, minHeight: 480).background(Theme.bg)
    }
}

struct MorningBriefView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        let cal = Calendar.current
        let endOfDay = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: Date())) ?? Date()
        let due = model.openItems.filter { $0.kind == .owe && ($0.dueAt.map { $0 < endOfDay } ?? false) }
        let waits = model.openItems.filter { $0.kind == .wait && (Rules.isStaleWait($0, now: Date(), settings: model.settings) || Rules.isOverdue($0, now: Date())) }
        Page("Good morning", subtitle: Fmt.short(Date(), "EEEE, d MMMM")) {
            SectionHeader(title: "You owe, due today or earlier", count: due.count)
            ItemList(items: due)
            SectionHeader(title: "Owed to you, stale or late", count: waits.count)
            ItemList(items: waits)
            if due.isEmpty && waits.isEmpty { Text("Clear start.").font(.system(size: 12.5)).foregroundStyle(Theme.text2).padding(8) }
        }
        .frame(minWidth: 560, minHeight: 480).background(Theme.bg)
    }
}

// MARK: - Menu bar popover

struct PopoverView: View {
    @EnvironmentObject var model: AppModel
    @State private var quick = ""

    var body: some View {
        let t = model.today
        let list = t.slipping + t.overdue + t.today + t.waitingStale
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Today").font(Theme.title(20)).foregroundStyle(Theme.text)
                Spacer()
                Button { model.openCapture() } label: { Image(systemName: "plus") }.buttonStyle(.plain).foregroundStyle(Theme.text2).help("Capture")
                Button { model.openMain() } label: { Image(systemName: "macwindow") }.buttonStyle(.plain).foregroundStyle(Theme.text2).help("Open Jaffloop")
            }.padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 6)
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
            if list.isEmpty && t.inbox.isEmpty {
                AllClosed().scaleEffect(0.8).padding(.bottom, 40)
            } else {
                let content = VStack(spacing: 0) {
                    ForEach(Array(list.enumerated()), id: \.element.id) { idx, i in ItemRow(item: i, index: idx, showPerson: true, showKind: false, compact: true) }
                    if !t.inbox.isEmpty {
                        HStack { Image(systemName: "tray").font(.system(size: 11)); Text("\(t.inbox.count) in Inbox").font(.system(size: 12)); Spacer() }
                            .foregroundStyle(Theme.text2).padding(.horizontal, 16).padding(.vertical, 10)
                            .contentShape(Rectangle()).onTapGesture { model.nav = .inbox; model.openMain() }
                    }
                }.padding(.horizontal, 6).padding(.top, 4)
                if model.snapshot { content } else { ScrollView { content } }
            }
            Spacer(minLength: 0)
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
            HStack(spacing: 8) {
                Image(systemName: "plus").font(.system(size: 11)).foregroundStyle(Theme.text2)
                TextField("Quick add — owe @sara review RFC fri", text: $quick).textFieldStyle(.plain).font(.system(size: 13))
                    .onSubmit { model.save(quick); quick = "" }
            }.padding(.horizontal, 16).padding(.vertical, 10)
        }
        .frame(width: 400, height: 460)
        .background(Theme.bg)
    }
}

// MARK: - Settings

struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    var onHotkeyChange: () -> Bool
    @State private var tab: String
    @State private var copied = false

    init(onHotkeyChange: @escaping () -> Bool, initialTab: String = "general") {
        self.onHotkeyChange = onHotkeyChange; _tab = State(initialValue: initialTab)
    }

    var body: some View {
        TabView(selection: $tab) {
            general.tabItem { Label("General", systemImage: "gearshape") }.tag("general")
            notifications.tabItem { Label("Notifications", systemImage: "bell") }.tag("notifications")
            mcp.tabItem { Label("Claude (MCP)", systemImage: "sparkles") }.tag("mcp")
            data.tabItem { Label("Data", systemImage: "externaldrive") }.tag("data")
            about.tabItem { Label("About", systemImage: "info.circle") }.tag("about")
        }
        .frame(width: 560, height: 460)
    }

    func bind<T>(_ kp: WritableKeyPath<AppSettings, T>) -> Binding<T> {
        Binding(get: { model.settings[keyPath: kp] }, set: { v in model.updateSettings { $0[keyPath: kp] = v } })
    }

    func timeBinding(_ kp: WritableKeyPath<AppSettings, String>) -> Binding<Date> {
        Binding(get: {
            let (h, m) = AppSettings.hm(model.settings[keyPath: kp])
            return Calendar.current.date(bySettingHour: h, minute: m, second: 0, of: Date()) ?? Date()
        }, set: { d in
            let c = Calendar.current.dateComponents([.hour, .minute], from: d)
            model.updateSettings { $0[keyPath: kp] = String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0) }
        })
    }

    var general: some View {
        Form {
            LabeledContent("Capture hotkey") { HotkeyRecorder(apply: onHotkeyChange) }
            Picker("Appearance", selection: $model.appearance) { ForEach(AppearanceChoice.allCases) { Text($0.label).tag($0) } }
                .onChange(of: model.appearance) { _, a in NSApp.appearance = a.nsAppearance }
            LabeledContent("Accent") {
                HStack(spacing: 10) {
                    ForEach(AccentChoice.allCases) { a in
                        Button { model.accent = a } label: {
                            Circle().fill(a.color).frame(width: 18, height: 18)
                                .overlay(Circle().strokeBorder(Color.primary.opacity(model.accent == a ? 0.9 : 0), lineWidth: 2).padding(-3))
                        }.buttonStyle(.plain).help(a.label).accessibilityLabel("\(a.label) accent").accessibilityAddTraits(model.accent == a ? .isSelected : [])
                    }
                }
            }
            Picker("Row density", selection: $model.density) { ForEach(Density.allCases) { Text($0.label).tag($0) } }.pickerStyle(.segmented)
            VStack(spacing: 4) {
                ForEach(Density.allCases) { d in
                    VStack(alignment: .leading, spacing: 0) {
                        Text(d.label.uppercased()).font(.system(size: 10, weight: .medium)).tracking(0.7).foregroundStyle(.secondary).padding(.leading, 8).padding(.top, 4)
                        ItemRow(item: Self.sample, showPerson: false, densityOverride: d).allowsHitTesting(false)
                    }
                    .background(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.accent, lineWidth: model.density == d ? 1.2 : 0))
                }
            }
            Toggle("Haptic feedback on completing an item", isOn: bind(\.haptics))
            Toggle("Sounds (save click, completion tone)", isOn: bind(\.sound))
            DatePicker("End of day (eod)", selection: timeBinding(\.eodTime), displayedComponents: .hourAndMinute)
            Stepper("Stale wait: \(model.settings.staleDaysAfterDue) days after due", value: bind(\.staleDaysAfterDue), in: 1...30)
            Stepper("Stale undated wait: \(model.settings.staleDaysNoDue) days after creation", value: bind(\.staleDaysNoDue), in: 1...30)
        }.formStyle(.grouped)
    }

    static let sample = Item(kind: .owe, title: "Review RFC for the on-call rotation", body: "Sara asked for comments before Friday",
                             dueAt: Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: Date())))

    var about: some View {
        Form {
            LabeledContent("Version", value: AppInfo.version)
            Section("Updates") {
                UpdatePanel(updates: model.updates)
                Toggle("Check for updates once a day", isOn: $model.autoUpdateCheck)
                Text("Off by default. Jaffloop makes no network calls except when you press Check for updates or turn this on. Nothing is downloaded or installed for you.")
                    .font(.system(size: 11.5)).foregroundStyle(.secondary)
            }
            Section("Release notes") {
                Button("What's new and roadmap") { model.nav = .releases; model.openMain() }
            }
        }.formStyle(.grouped)
    }

    var notifications: some View {
        Form {
            DatePicker("Working hours start", selection: timeBinding(\.workStart), displayedComponents: .hourAndMinute)
            DatePicker("Working hours end", selection: timeBinding(\.workEnd), displayedComponents: .hourAndMinute)
            DatePicker("Morning brief (weekdays)", selection: timeBinding(\.morningBrief), displayedComponents: .hourAndMinute)
            Text("No notifications outside working hours or on weekends, except reminders you set explicitly. At most one notification every 10 minutes; items in the same window are batched.")
                .font(.system(size: 12)).foregroundStyle(.secondary)
        }.formStyle(.grouped)
    }

    var mcp: some View {
        let appPath = model.snapshot ? "/Applications/Jaffloop.app" : Bundle.main.bundlePath   // README shots must not show a dev path
        let cmd = "claude mcp add jaffloop -- \"\(appPath)/Contents/MacOS/jaffloop-mcp\""
        return Form {
            Section("Connect") {
                Text(cmd).font(.system(size: 11, design: .monospaced)).textSelection(.enabled)
                HStack {
                    Button(copied ? "Copied" : "Copy command") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(cmd, forType: .string); copied = true }
                    Text("Claude Code. For Claude Desktop add the same binary as a stdio server.").font(.system(size: 11)).foregroundStyle(.secondary)
                }
            }
            Section("Privacy") {
                Toggle("Read-only: block all write tools", isOn: bind(\.mcpReadOnly))
                ForEach(model.summaries) { s in
                    Toggle(s.person.name, isOn: Binding(get: { s.person.hiddenFromClaude }, set: { v in var p = s.person; p.hiddenFromClaude = v; model.savePerson(p) }))
                }
                Text("People toggled on are hidden from Claude: excluded from every tool and resource.").font(.system(size: 11)).foregroundStyle(.secondary)
            }
            Section("Recent MCP calls") {
                if model.auditLog.isEmpty { Text("None yet.").foregroundStyle(.secondary) }
                ForEach(model.auditLog.prefix(8)) { e in
                    HStack {
                        Text(Fmt.short(e.at, "d MMM HH:mm")).font(.system(size: 11).monospacedDigit()).foregroundStyle(.secondary)
                        Text(e.tool).font(.system(size: 11, design: .monospaced))
                        Text(e.summary).font(.system(size: 11)).lineLimit(1).foregroundStyle(.secondary)
                        Spacer()
                        if e.wrote { Text("wrote").font(.system(size: 10, design: .monospaced)).foregroundStyle(Theme.clay) }
                    }
                }
            }
        }.formStyle(.grouped)
    }

    var data: some View {
        Form {
            LabeledContent("Database", value: JaffloopPaths.defaultURL.path)
            Button("Reveal in Finder") { NSWorkspace.shared.activateFileViewerSelecting([JaffloopPaths.defaultURL]) }
            Button("Export everything as JSON…") {
                let p = NSSavePanel(); p.nameFieldStringValue = "jaffloop-export.json"
                if p.runModal() == .OK, let u = p.url, let d = try? model.store.exportJSON() { try? d.write(to: u) }
            }
            Text("Everything stays on this Mac. The only network call is the update check, and only when you ask for it.").font(.system(size: 12)).foregroundStyle(.secondary)
        }.formStyle(.grouped)
    }
}

// MARK: - Hotkey recorder

/// Click, then press the shortcut you want. Needs ⌃, ⌥ or ⌘ unless it is a function key.
struct HotkeyRecorder: View {
    @EnvironmentObject var model: AppModel
    var apply: () -> Bool
    @State private var recording = false
    @State private var monitor: Any?
    @State private var message: String?

    var body: some View {
        HStack(spacing: 10) {
            Button { recording ? stop() : start() } label: {
                Text(recording ? "Press shortcut…" : hotkeyLabel(model.settings.hotkey))
                    .font(.system(size: 12, design: .monospaced))
                    .frame(minWidth: 120).padding(.vertical, 4)
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(recording ? Theme.clay : Theme.hairline, lineWidth: recording ? 1.5 : 0.5))
            }.buttonStyle(.plain)
            if model.settings.hotkey != HotkeyManager.defaultSpec && !recording {
                Button("Reset") { set(HotkeyManager.defaultSpec) }.buttonStyle(.link).font(.system(size: 12))
            }
            if let message { Text(message).font(.system(size: 11.5)).foregroundStyle(Theme.clay) }
        }
        .onDisappear { stop() }
    }

    private func start() {
        message = nil; recording = true
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { e in handle(e); return nil }
    }

    private func stop() {
        recording = false
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }

    private func handle(_ e: NSEvent) {
        if e.keyCode == 53 { stop(); return }                       // esc cancels
        guard let key = HotkeyManager.keyName(forCode: Int(e.keyCode)) else { message = "That key is not supported."; return }
        let f = e.modifierFlags
        var parts: [String] = []
        if f.contains(.control) { parts.append("ctrl") }
        if f.contains(.option) { parts.append("opt") }
        if f.contains(.command) { parts.append("cmd") }
        if f.contains(.shift) { parts.append("shift") }
        let hasMain = f.contains(.control) || f.contains(.option) || f.contains(.command)
        guard hasMain || (key.hasPrefix("f") && key.count > 1) else { message = "Add ⌃, ⌥ or ⌘."; return }
        stop()
        set((parts + [key]).joined(separator: "+"))
    }

    private func set(_ spec: String) {
        let old = model.settings.hotkey
        model.updateSettings { $0.hotkey = spec }
        if apply() { message = nil } else {
            model.updateSettings { $0.hotkey = old }
            _ = apply()
            message = "That shortcut is taken."
        }
    }
}
