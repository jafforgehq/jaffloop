import SwiftUI
import AppKit
import JaffloopCore
import GRDB

enum Nav: Hashable {
    case today, ledger, inbox, people, releases, done, snoozed, person(String), tag(String), filter(String)

    var stored: String {
        switch self {
        case .today: return "today"
        case .ledger: return "ledger"
        case .inbox: return "inbox"
        case .people: return "people"
        case .releases: return "releases"
        case .done: return "done"
        case .snoozed: return "snoozed"
        case .person(let id): return "person:\(id)"
        case .tag(let t): return "tag:\(t)"
        case .filter(let q): return "filter:\(q)"
        }
    }

    init?(stored s: String) {
        switch s {
        case "today": self = .today
        case "ledger": self = .ledger
        case "inbox": self = .inbox
        case "people": self = .people
        case "releases": self = .releases
        case "done": self = .done
        case "snoozed": self = .snoozed
        default:
            if s.hasPrefix("filter:") { self = .filter(String(s.dropFirst(7))) }
            else if s.hasPrefix("person:") { self = .person(String(s.dropFirst(7))) }
            else if s.hasPrefix("tag:") { self = .tag(String(s.dropFirst(4))) }
            else { return nil }
        }
    }
}

enum Density: String, CaseIterable, Identifiable {
    case compact, comfortable, spacious
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
    var rowPad: CGFloat { switch self { case .compact: return 4; case .comfortable: return 7; case .spacious: return 11 } }
    var titleFont: Font { .system(size: self == .spacious ? 14 : 13) }
    var showsBody: Bool { self != .compact }
}

enum AppearanceChoice: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
    var nsAppearance: NSAppearance? {
        switch self { case .system: return nil; case .light: return NSAppearance(named: .aqua); case .dark: return NSAppearance(named: .darkAqua) }
    }
}

enum AccentChoice: String, CaseIterable, Identifiable {
    case graphite, blue, green, violet, amber
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
    var color: Color {
        switch self {
        case .graphite: return Color(dark: 0x96938C, light: 0x6B6860)
        case .blue: return Color(dark: 0x7EA6D8, light: 0x2F6FB0)
        case .green: return Color(dark: 0x84B796, light: 0x3F7F55)
        case .violet: return Color(dark: 0xA999D6, light: 0x6C54A8)
        case .amber: return Color(dark: 0xD6A85C, light: 0x8F611A)
        }
    }
}

struct Toast: Identifiable {
    let id = UUID()
    var message: String
    var undo: (() -> Void)?
}

enum AppInfo {
    /// Lets the screenshot generator show a real version number.
    static var override: String?
    static var version: String { override ?? (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "dev" }
}

final class AppModel: ObservableObject {
    let store: Store
    let updates = UpdateChecker()
    @Published var settings = AppSettings()
    @Published var today = TodaySections()
    @Published var openItems: [Item] = []
    @Published var summaries: [PersonSummary] = []
    @Published var tags: [(String, Int)] = []
    @Published var nav: Nav = .today {
        didSet {
            if persist { UserDefaults.standard.set(nav.stored, forKey: "lastNav") }
            if !travelling { navHistory.visit(from: oldValue, to: nav) }
        }
    }
    @Published var showSearch = false
    @Published var lastCapture = ""
    @Published var captureBlip = 0
    @Published var dismissedCheckIns: Set<String> = []
    @Published var auditLog: [AuditEntry] = []

    // selection, drawer, bulk actions, undo
    @Published var selectedItemId: String? { didSet { if drawerItemId != nil { drawerItemId = selectedItemId } } }
    @Published var multi: Set<String> = []
    @Published var drawerItemId: String?
    @Published var triggerComplete: String?
    @Published var triggerEdit: String?
    @Published var toast: Toast?
    @Published var pulsePersonId: String?

    // look and layout preferences
    @Published var density: Density = .comfortable { didSet { save("density", density.rawValue) } }
    @Published var appearance: AppearanceChoice = .system { didSet { save("appearance", appearance.rawValue) } }
    @Published var accent: AccentChoice = .graphite { didSet { Theme.accent = accent.color; save("accent", accent.rawValue) } }
    @Published var pinnedPeople: Set<String> = [] { didSet { if persist { UserDefaults.standard.set(Array(pinnedPeople), forKey: "pinnedPeople") } } }
    @Published var collapsed: Set<String> = [] { didSet { if persist { UserDefaults.standard.set(Array(collapsed), forKey: "collapsedSections") } } }
    @Published var autoUpdateCheck = false { didSet { if persist { UserDefaults.standard.set(autoUpdateCheck, forKey: "autoUpdateCheck") } } }
    @Published var sidebarHidden = false { didSet { if persist { UserDefaults.standard.set(sidebarHidden, forKey: "sidebarHidden") } } }
    @Published var savedFilters: [String] = [] { didSet { if persist { UserDefaults.standard.set(savedFilters, forKey: "savedFilters") } } }
    @Published var pinOrder: [String] = [] { didSet { if persist { UserDefaults.standard.set(pinOrder, forKey: "pinOrder") } } }
    @Published var showShortcuts = false
    @Published var showWelcome = false
    @Published var reduceTransparency = NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency
    @Published var soundSave = "Tink" { didSet { save("soundSave", soundSave) } }
    @Published var soundComplete = "Glass" { didSet { save("soundComplete", soundComplete) } }
    @Published var soundUndo = "Pop" { didSet { save("soundUndo", soundUndo) } }
    /// Set for the session when the app has just been updated, so the banner can say from which version.
    @Published var updatedFrom: String?

    /// When true views skip entrance animation and system materials (used for README screenshots).
    var snapshot = false
    private let persist: Bool
    private var navHistory = NavHistory<Nav>()
    private var travelling = false

    var onChange: (() -> Void)?
    var openCapture: () -> Void = {}
    var openSettings: () -> Void = {}
    var openMain: () -> Void = {}
    var openMorningBrief: () -> Void = {}
    var openPersonBrief: (Person) -> Void = { _ in }
    private var version: Int64 = 0
    private var timer: Timer?
    var now: Date { Date() }

    init(store: Store, restoreState: Bool = true) {
        self.store = store
        self.persist = restoreState
        reload()
        version = store.dataVersion()
        if let d = UserDefaults.standard.array(forKey: "dismissedCheckIns") as? [String],
           UserDefaults.standard.string(forKey: "dismissedDay") == Fmt.short(Date(), "yyyy-MM-dd") {
            dismissedCheckIns = Set(d)
        }
        guard restoreState else { Theme.accent = accent.color; return }
        let u = UserDefaults.standard
        density = u.string(forKey: "density").flatMap(Density.init) ?? (settings.compact ? .compact : .comfortable)
        appearance = u.string(forKey: "appearance").flatMap(AppearanceChoice.init) ?? .system
        accent = u.string(forKey: "accent").flatMap(AccentChoice.init) ?? .graphite
        pinnedPeople = Set(u.stringArray(forKey: "pinnedPeople") ?? [])
        collapsed = Set(u.stringArray(forKey: "collapsedSections") ?? [])
        autoUpdateCheck = u.bool(forKey: "autoUpdateCheck")
        sidebarHidden = u.bool(forKey: "sidebarHidden")
        savedFilters = u.stringArray(forKey: "savedFilters") ?? []
        pinOrder = u.stringArray(forKey: "pinOrder") ?? []
        soundSave = u.string(forKey: "soundSave") ?? "Tink"
        soundComplete = u.string(forKey: "soundComplete") ?? "Glass"
        soundUndo = u.string(forKey: "soundUndo") ?? "Pop"
        if let s = u.string(forKey: "lastNav"), let n = Nav(stored: s) {
            switch n {
            case .person(let id) where summary(id) == nil: break
            default: nav = n
            }
        }
        navHistory = NavHistory()
        checkWhatsNew()
        if !u.bool(forKey: "welcomeSeen") {
            if openItems.isEmpty && summaries.isEmpty && updatedFrom == nil { showWelcome = true } else { u.set(true, forKey: "welcomeSeen") }
        }
        NotificationCenter.default.addObserver(forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.reduceTransparency = NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency
        }
    }

    private func save(_ key: String, _ value: String) { if persist { UserDefaults.standard.set(value, forKey: key) } }

    // MARK: updates and release notes

    /// First launch after an update: remember the old version and show What's new once.
    private func checkWhatsNew() {
        guard AppVersion(AppInfo.version) != nil else { return }
        let u = UserDefaults.standard
        guard let last = u.string(forKey: "lastSeenVersion") else {
            // 0.0.2 and earlier never recorded a version: existing data means this is an update, not a fresh install.
            u.set(AppInfo.version, forKey: "lastSeenVersion")
            if !openItems.isEmpty || !summaries.isEmpty { updatedFrom = "an earlier version"; nav = .releases }
            return
        }
        if last != AppInfo.version, let a = AppVersion(last), let b = AppVersion(AppInfo.version), b > a {
            updatedFrom = last
            nav = .releases
        }
    }

    var hasUnseenRelease: Bool {
        persist && AppVersion(AppInfo.version) != nil && UserDefaults.standard.string(forKey: "lastSeenVersion") != AppInfo.version
    }

    func markVersionSeen() {
        guard persist, AppVersion(AppInfo.version) != nil else { return }
        UserDefaults.standard.set(AppInfo.version, forKey: "lastSeenVersion")
        objectWillChange.send()
    }

    // MARK: watching and loading

    /// Cheap cross-process watcher: the MCP server writes through its own connection.
    func startWatching() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                let v = self.store.dataVersion()
                if v != self.version { self.version = v; self.reload() }
            }
        }
    }

    func reload() {
        let n = Date()
        settings = store.settings()
        today = (try? store.today(now: n)) ?? TodaySections()
        var f = ItemFilter(); f.includeSnoozed = false
        openItems = (try? store.items(f, now: n)) ?? []
        summaries = (try? store.personSummaries(now: n)) ?? []
        tags = (try? store.allTags()) ?? []
        auditLog = store.auditLog()
        onChange?()
    }

    // MARK: lookups

    func person(_ id: String?) -> Person? { id.flatMap { id in summaries.first { $0.person.id == id }?.person } }
    func summary(_ id: String) -> PersonSummary? { summaries.first { $0.person.id == id } }
    var orderedPeople: [PersonSummary] { PeopleOrder.sorted(summaries, pinned: pinnedPeople) }
    var overdueCount: Int { openItems.filter { Rules.isOverdue($0, now: now) || Rules.isSlipping($0) }.count }
    var inboxItems: [Item] { openItems.filter { $0.inbox } }
    var ledgerItems: [Item] { openItems.filter { $0.kind == .owe } }
    func items(for personId: String, kind: ItemKind) -> [Item] { openItems.filter { $0.personId == personId && $0.kind == kind } }
    func saidLog(for personId: String) -> [Item] {
        var f = ItemFilter(); f.personId = personId; f.kinds = [.said]; f.status = nil
        return (try? store.items(f, now: now)) ?? []
    }
    func tagsOf(_ id: String) -> [String] { (try? store.tags(of: id)) ?? [] }
    func item(_ id: String) -> Item? { openItems.first { $0.id == id } ?? ((try? store.item(id)) ?? nil) }
    var drawerItem: Item? { drawerItemId.flatMap { item($0) } }
    func interactionDates(_ personId: String) -> [Date] { ((try? store.interactions(personId: personId, limit: 80)) ?? []).map { $0.occurredAt } }

    /// People ordered by who you most recently captured something for.
    var recentPeople: [Person] {
        var last: [String: Date] = [:]
        for i in openItems { if let p = i.personId { last[p] = max(last[p] ?? .distantPast, i.createdAt) } }
        return summaries.map { $0.person }.sorted { (last[$0.id] ?? .distantPast) > (last[$1.id] ?? .distantPast) }
    }

    func navTitle(_ n: Nav) -> String {
        switch n {
        case .today: return "Today"
        case .ledger: return "Promise ledger"
        case .inbox: return "Inbox"
        case .people: return "People"
        case .releases: return "What's new"
        case .done: return "Done"
        case .snoozed: return "Snoozed"
        case .filter(let q): return q
        case .person(let id): return summary(id)?.person.name ?? "Person"
        case .tag(let t): return "#\(t)"
        }
    }

    // MARK: toast and undo

    func showToast(_ message: String, undo: (() -> Void)? = nil) {
        let t = Toast(message: message, undo: undo)
        withAnimation(Motion.ease(0.2)) { toast = t }
        DispatchQueue.main.asyncAfter(deadline: .now() + 7) { [weak self] in
            guard let self, self.toast?.id == t.id else { return }
            withAnimation(Motion.ease(0.2)) { self.toast = nil }
        }
    }

    func undoLast() {
        guard let t = toast else { return }
        withAnimation(Motion.ease(0.2)) { toast = nil }
        play(soundUndo)
        t.undo?()
    }

    private func short(_ s: String) -> String { s.count > 34 ? String(s.prefix(33)) + "…" : s }
    private func prior(_ ids: [String]) -> [Item] { ids.compactMap { (try? store.item($0)) ?? nil } }
    private func restore(_ items: [Item], drop spawned: [Item] = []) {
        for i in items { try? store.restore(i) }
        for s in spawned { try? store.drop(s.id) }
        reload()
    }

    // MARK: actions

    func save(_ line: String, stay: Bool = false) {
        guard !line.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        _ = try? store.capture(line, source: .hotkey)
        lastCapture = line
        captureBlip += 1
        play(soundSave)
        reload()
    }

    func complete(_ i: Item) { completeMany([i.id], label: short(i.title)) }

    func completeMany(_ ids: [String], label: String? = nil) {
        let before = prior(ids)
        var spawned: [Item] = []
        for id in ids { if let n = (try? store.complete(id)) ?? nil { spawned.append(n) } }
        if settings.haptics { NSHapticFeedbackManager.defaultPerformer.perform(.levelChange, performanceTime: .now) }
        play(soundComplete)
        multi.subtract(ids)
        reload()
        showToast("Done · \(label ?? "\(ids.count) items")") { [weak self] in self?.restore(before, drop: spawned) }
    }

    func reopen(_ i: Item) {
        let before = prior([i.id])
        try? store.reopen(i.id)
        reload()
        showToast("Reopened · \(short(i.title))") { [weak self] in self?.restore(before) }
    }

    /// Bring a snoozed item back now.
    func wake(_ i: Item) {
        let before = prior([i.id])
        try? store.update(i.id) { $0.snoozedUntil = nil }
        reload()
        showToast("Back on your list · \(short(i.title))") { [weak self] in self?.restore(before) }
    }

    /// Generic edit with an undo toast (drawer fields, inline dates, kind, person).
    func update(_ i: Item, _ message: String, _ change: @escaping (inout Item) -> Void) {
        let before = prior([i.id])
        try? store.update(i.id, change)
        reload()
        showToast(message) { [weak self] in self?.restore(before) }
    }

    func setTags(_ i: Item, _ tags: [String]) {
        let old = tagsOf(i.id)
        let clean = tags.map { $0.trimmingCharacters(in: .whitespaces).lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "#")) }.filter { !$0.isEmpty }
        guard clean != old else { return }
        try? store.setTags(i.id, clean)
        reload()
        showToast("Tags updated") { [weak self] in try? self?.store.setTags(i.id, old); self?.reload() }
    }

    func play(_ name: String) {
        guard settings.sound, name != "None" else { return }
        NSSound(named: NSSound.Name(name))?.play()
    }

    // MARK: history, filters, layout

    func goBack() {
        travelling = true; defer { travelling = false }
        if let n = navHistory.goBack(from: nav) { nav = n }
    }
    func goForward() {
        travelling = true; defer { travelling = false }
        if let n = navHistory.goForward(from: nav) { nav = n }
    }
    func toggleSidebar() { withAnimation(Motion.spring()) { sidebarHidden.toggle() } }

    func addFilter(_ q: String) {
        let t = q.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty, !savedFilters.contains(t) else { return }
        savedFilters.append(t)
        showToast("Saved filter · \(t)")
    }
    func removeFilter(_ q: String) { savedFilters.removeAll { $0 == q }; if nav == .filter(q) { nav = .today } }
    func filterItems(_ q: String) -> [Item] { (try? store.search(q, limit: 200)) ?? [] }

    func ordered(_ items: [Item]) -> [Item] { PinOrder.apply(items, order: pinOrder) }
    func movePin(_ id: String, onto target: String) {
        let base = PinOrder.apply(openItems.filter { $0.pinned }, order: pinOrder).map { $0.id }
        pinOrder = PinOrder.move(id, onto: target, in: base)
    }

    /// Jump from search to an item: open the list it lives in and select it.
    func reveal(_ i: Item) {
        if i.status != .open { nav = .done }
        else if let pid = i.personId { nav = .person(pid) }
        else if i.inbox { nav = .inbox }
        else { nav = .today }
        selectedItemId = i.id
    }

    func dismissWelcome(addExample: Bool = false) {
        if addExample { _ = try? store.capture("todo Try Jaffloop: press \(hotkeyLabel(settings.hotkey)) and capture something fri"); reload() }
        UserDefaults.standard.set(true, forKey: "welcomeSeen")
        withAnimation(Motion.ease(0.25)) { showWelcome = false }
    }

    func drop(_ i: Item) { dropMany([i.id], label: short(i.title)) }

    func dropMany(_ ids: [String], label: String? = nil) {
        let before = prior(ids)
        for id in ids { try? store.drop(id) }
        multi.subtract(ids)
        reload()
        showToast("Dropped · \(label ?? "\(ids.count) items")") { [weak self] in self?.restore(before) }
    }

    func snooze(_ i: Item, until: Date) { snoozeMany([i.id], until: until, label: short(i.title)) }

    func snoozeMany(_ ids: [String], until: Date, label: String? = nil) {
        let before = prior(ids)
        for id in ids { try? store.snooze(id, until: until) }
        multi.subtract(ids)
        reload()
        showToast("Snoozed · \(label ?? "\(ids.count) items") until \(Fmt.backLabel(until).replacingOccurrences(of: "back ", with: ""))") { [weak self] in self?.restore(before) }
    }

    func assign(_ i: Item, handle: String?, due: Date?) { assignMany([i.id], handle: handle, due: due, label: short(i.title)) }

    func assignMany(_ ids: [String], handle: String?, due: Date? = nil, label: String? = nil) {
        let before = prior(ids)
        for id in ids { try? store.assign(id, personHandle: handle, due: due) }
        multi.subtract(ids)
        reload()
        let who = handle.flatMap { h in summaries.first { $0.person.handle == h }?.person.name }
        showToast("\(who.map { "Assigned to \($0)" } ?? "Updated") · \(label ?? "\(ids.count) items")") { [weak self] in self?.restore(before) }
    }

    /// "owe review RFC fri" typed on someone's page becomes "owe @handle review RFC fri".
    func captureFor(_ p: Person, _ text: String) {
        let t = text.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        let first = t.split(separator: " ").first.map { String($0).lowercased() } ?? ""
        let line = CaptureParser.prefixes[first] != nil && t.contains(" ")
            ? first + " @\(p.handle) " + t.dropFirst(first.count).trimmingCharacters(in: .whitespaces)
            : "@\(p.handle) " + t
        save(line)
    }

    func rename(_ i: Item, _ title: String) {
        let before = prior([i.id])
        try? store.update(i.id) { $0.title = title }
        reload()
        showToast("Renamed") { [weak self] in self?.restore(before) }
    }

    func togglePin(_ i: Item) { try? store.update(i.id) { $0.pinned.toggle() }; reload() }

    func logInteraction(_ p: Person, kind: InteractionKind = .oneOnOne) {
        _ = try? store.logInteraction(personId: p.id, kind: kind)
        pulsePersonId = p.id
        withAnimation(Motion.ease(0.5)) { reload() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in if self?.pulsePersonId == p.id { self?.pulsePersonId = nil } }
    }

    func savePerson(_ p: Person) { try? store.savePerson(p); reload() }

    func addPerson(name: String) -> Person? {
        let handle = name.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }).joined(separator: ".")
        guard !handle.isEmpty else { return nil }
        let p = (try? store.person(handle: handle)) ?? nil
        if var p, p.name.lowercased() == handle.replacingOccurrences(of: ".", with: " ") { p.name = name; try? store.savePerson(p) }
        reload()
        return p
    }

    func updateSettings(_ change: (inout AppSettings) -> Void) {
        var s = settings
        change(&s)
        settings = s
        try? store.saveSettings(s)
        onChange?()
    }

    func dismissCheckIn(_ id: String) {
        dismissedCheckIns.insert(id)
        UserDefaults.standard.set(Array(dismissedCheckIns), forKey: "dismissedCheckIns")
        UserDefaults.standard.set(Fmt.short(Date(), "yyyy-MM-dd"), forKey: "dismissedDay")
    }

    // MARK: selection helpers

    func toggleMulti(_ id: String) { if multi.contains(id) { multi.remove(id) } else { multi.insert(id) } }
    func toggleCollapsed(_ key: String) { if collapsed.contains(key) { collapsed.remove(key) } else { collapsed.insert(key) } }
    func togglePinned(person id: String) { if pinnedPeople.contains(id) { pinnedPeople.remove(id) } else { pinnedPeople.insert(id) } }
    func toggleDrawer() { drawerItemId = drawerItemId == nil ? selectedItemId : nil }
    func dragPayload(for id: String) -> String { multi.contains(id) ? multi.sorted().joined(separator: ",") : id }

    // MARK: snooze presets

    struct SnoozePreset: Identifiable { var id: String { label }; var label: String; var date: Date }

    func snoozePresets() -> [SnoozePreset] {
        let cal = Calendar.current
        let n = now
        func at(_ d: Date, _ h: Int, _ m: Int = 0) -> Date { cal.date(bySettingHour: h, minute: m, second: 0, of: d) ?? d }
        var out = [SnoozePreset(label: "1 hour", date: n.addingTimeInterval(3600))]
        if cal.component(.hour, from: n) < 14 { out.append(SnoozePreset(label: "This afternoon", date: at(n, 15))) }
        let tomorrow = cal.date(byAdding: .day, value: 1, to: n) ?? n
        out.append(SnoozePreset(label: "Tomorrow \(Fmt.short(at(tomorrow, 9), "HH:mm"))", date: at(tomorrow, 9)))
        let mon = cal.nextDate(after: n, matching: DateComponents(hour: 9, weekday: 2), matchingPolicy: .nextTime) ?? tomorrow
        out.append(SnoozePreset(label: "Next Monday", date: mon))
        return out
    }
}
