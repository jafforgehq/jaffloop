import SwiftUI
import AppKit
import JaffloopCore

// MARK: - Pre-meeting card

struct PreMeetingCard: View {
    @EnvironmentObject var model: AppModel
    let person: Person
    let event: CalEvent
    var onOpen: () -> Void
    var onDismiss: () -> Void
    @State private var shown = false

    var body: some View {
        let owe = model.items(for: person.id, kind: .owe)
        let wait = model.items(for: person.id, kind: .wait)
        let bring = model.items(for: person.id, kind: .bring)
        let top = Array((owe + wait + bring).prefix(3))
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Avatar(person: person, size: 28)
                VStack(alignment: .leading, spacing: 1) {
                    Text(event.title).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                    Text("\(Fmt.short(event.start, "HH:mm")) · in \(max(0, Int(event.start.timeIntervalSinceNow / 60))) min").font(Theme.date).foregroundStyle(Theme.text2)
                }
                Spacer()
                Button(action: onDismiss) { Image(systemName: "xmark").font(.system(size: 10)).foregroundStyle(Theme.text2) }.buttonStyle(.plain)
            }
            HStack(spacing: 14) {
                count("\(owe.count)", "you owe", .owe); count("\(wait.count)", "they owe", .wait); count("\(bring.count)", "to bring up", .bring)
            }
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
            if top.isEmpty { Text("Nothing open with \(person.name.split(separator: " ").first.map(String.init) ?? person.name).").font(.system(size: 12.5)).foregroundStyle(Theme.text2) }
            VStack(spacing: 0) { ForEach(top) { ItemRow(item: $0, showPerson: false, compact: true) } }
            HStack { PrimaryButton(title: "Open brief", action: onOpen); GhostButton(title: "Dismiss", action: onDismiss) }
        }
        .padding(16).frame(width: 380)
        .background(RoundedRectangle(cornerRadius: 16).fill(model.snapshot ? Theme.elevated : Theme.surface))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.hairline, lineWidth: 0.5))
        .shadow(color: .black.opacity(0.35), radius: 24, y: 10)
        .padding(30)
        .offset(y: shown || model.snapshot ? 0 : 60).opacity(shown || model.snapshot ? 1 : 0)
        .onAppear { withAnimation(.spring(response: Motion.reduced ? 0.2 : 0.45, dampingFraction: 0.78)) { shown = true } }
    }

    func count(_ n: String, _ l: String, _ k: ItemKind) -> some View {
        HStack(spacing: 5) {
            Circle().fill(Theme.kind(k)).frame(width: 6, height: 6)
            Text(n).font(.system(size: 13, weight: .semibold).monospacedDigit())
            Text(l).font(.system(size: 11.5)).foregroundStyle(Theme.text2)
        }
    }
}

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
            SectionHeader(title: "Meetings today", count: model.meetings.count)
            if model.meetings.isEmpty {
                Text(model.settings.calendarEnabled ? "No meetings on your calendar." : "Calendar access is off. Enable it in Settings to see meetings here.")
                    .font(.system(size: 12.5)).foregroundStyle(Theme.text2).padding(8)
            }
            ForEach(model.meetings) { e in
                HStack(spacing: 10) {
                    Text(Fmt.short(e.start, "HH:mm")).font(Theme.date).foregroundStyle(Theme.text2).frame(width: 46, alignment: .leading)
                    Text(e.title).font(Theme.row)
                    Spacer()
                    if let p = CalendarService.match(e, people: model.summaries.map { $0.person }) {
                        Avatar(person: p, size: 16); Text(p.name).font(.system(size: 11.5)).foregroundStyle(Theme.text2)
                    }
                }.padding(.vertical, 5).padding(.horizontal, 8)
            }
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
        }
        .frame(width: 400, height: 460)
        .background(Theme.bg)
    }
}

// MARK: - Settings

struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    var calendar: CalendarService
    var onHotkeyChange: () -> Void
    @State private var tab: String
    @State private var copied = false

    init(calendar: CalendarService, onHotkeyChange: @escaping () -> Void, initialTab: String = "general") {
        self.calendar = calendar; self.onHotkeyChange = onHotkeyChange; _tab = State(initialValue: initialTab)
    }

    var body: some View {
        TabView(selection: $tab) {
            general.tabItem { Label("General", systemImage: "gearshape") }.tag("general")
            notifications.tabItem { Label("Notifications", systemImage: "bell") }.tag("notifications")
            calendarTab.tabItem { Label("Calendar", systemImage: "calendar") }.tag("calendar")
            mcp.tabItem { Label("Claude (MCP)", systemImage: "sparkles") }.tag("mcp")
            data.tabItem { Label("Data", systemImage: "externaldrive") }.tag("data")
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
            Picker("Capture hotkey", selection: Binding(get: { model.settings.hotkey }, set: { v in model.updateSettings { $0.hotkey = v }; onHotkeyChange() })) {
                ForEach(HotkeyManager.presets, id: \.0) { Text($0.1).tag($0.0) }
            }
            Picker("Density", selection: bind(\.compact)) { Text("Comfortable").tag(false); Text("Compact").tag(true) }
            Toggle("Haptic feedback on completing an item", isOn: bind(\.haptics))
            Toggle("Sounds (save click, completion tone)", isOn: bind(\.sound))
            DatePicker("End of day (eod)", selection: timeBinding(\.eodTime), displayedComponents: .hourAndMinute)
            Stepper("Stale wait: \(model.settings.staleDaysAfterDue) days after due", value: bind(\.staleDaysAfterDue), in: 1...30)
            Stepper("Stale undated wait: \(model.settings.staleDaysNoDue) days after creation", value: bind(\.staleDaysNoDue), in: 1...30)
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

    var calendarTab: some View {
        Form {
            Toggle("Use my calendar for pre-meeting and morning briefs", isOn: Binding(get: { model.settings.calendarEnabled }, set: { on in
                model.updateSettings { $0.calendarEnabled = on }
                if on { calendar.requestAccess { _ in model.reload() } }
            }))
            LabeledContent("Access", value: calendar.status)
            Stepper("Pre-meeting brief: \(model.settings.preMeetingMinutes) min before", value: bind(\.preMeetingMinutes), in: 2...60)
            Stepper("Only meetings with \(model.settings.maxAttendees) attendees or fewer", value: bind(\.maxAttendees), in: 2...20)
            Text("Read-only. Events are matched to people by attendee email (set on the person), falling back to their name in the event title.")
                .font(.system(size: 12)).foregroundStyle(.secondary)
        }.formStyle(.grouped)
    }

    var mcp: some View {
        let cmd = "claude mcp add jaffloop -- \"\(Bundle.main.bundlePath)/Contents/MacOS/jaffloop-mcp\""
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
            Text("Everything stays on this Mac. Jaffloop makes no network calls.").font(.system(size: 12)).foregroundStyle(.secondary)
        }.formStyle(.grouped)
    }
}
