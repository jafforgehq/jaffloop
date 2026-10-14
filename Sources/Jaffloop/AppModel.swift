import SwiftUI
import AppKit
import JaffloopCore
import GRDB

enum Nav: Hashable {
    case today, ledger, inbox, people, person(String), tag(String)
}

final class AppModel: ObservableObject {
    let store: Store
    @Published var settings = AppSettings()
    @Published var today = TodaySections()
    @Published var openItems: [Item] = []
    @Published var summaries: [PersonSummary] = []
    @Published var tags: [(String, Int)] = []
    @Published var nav: Nav = .today
    @Published var showSearch = false
    @Published var lastCapture = ""
    @Published var captureBlip = 0
    @Published var dismissedCheckIns: Set<String> = []
    @Published var meetings: [CalEvent] = []
    @Published var auditLog: [AuditEntry] = []
    /// When true views skip entrance animation and system materials (used for README screenshots).
    var snapshot = false

    var onChange: (() -> Void)?
    var openCapture: () -> Void = {}
    var openSettings: () -> Void = {}
    var openMain: () -> Void = {}
    var openMorningBrief: () -> Void = {}
    var openPersonBrief: (Person) -> Void = { _ in }
    private var version: Int64 = 0
    private var timer: Timer?
    var now: Date { Date() }

    init(store: Store) {
        self.store = store
        reload()
        version = store.dataVersion()
        if let d = UserDefaults.standard.array(forKey: "dismissedCheckIns") as? [String],
           UserDefaults.standard.string(forKey: "dismissedDay") == Fmt.short(Date(), "yyyy-MM-dd") {
            dismissedCheckIns = Set(d)
        }
    }

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
    var overdueCount: Int { openItems.filter { Rules.isOverdue($0, now: now) || Rules.isSlipping($0) }.count }
    var inboxItems: [Item] { openItems.filter { $0.inbox } }
    var ledgerItems: [Item] { openItems.filter { $0.kind == .owe } }
    func items(for personId: String, kind: ItemKind) -> [Item] { openItems.filter { $0.personId == personId && $0.kind == kind } }
    func saidLog(for personId: String) -> [Item] {
        var f = ItemFilter(); f.personId = personId; f.kinds = [.said]; f.status = nil
        return (try? store.items(f, now: now)) ?? []
    }
    func tagsOf(_ id: String) -> [String] { (try? store.tags(of: id)) ?? [] }

    // MARK: actions

    func save(_ line: String, stay: Bool = false) {
        guard !line.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        _ = try? store.capture(line, source: .hotkey)
        lastCapture = line
        captureBlip += 1
        if settings.sound { NSSound(named: "Tink")?.play() }
        reload()
    }

    func complete(_ i: Item) {
        _ = try? store.complete(i.id)
        if settings.haptics { NSHapticFeedbackManager.defaultPerformer.perform(.levelChange, performanceTime: .now) }
        if settings.sound { NSSound(named: "Glass")?.play() }
        reload()
    }

    func reopen(_ i: Item) { try? store.reopen(i.id); reload() }
    func drop(_ i: Item) { try? store.drop(i.id); reload() }
    func snooze(_ i: Item, until: Date) { try? store.snooze(i.id, until: until); reload() }
    func assign(_ i: Item, handle: String?, due: Date?) { try? store.assign(i.id, personHandle: handle, due: due); reload() }
    func togglePin(_ i: Item) { try? store.update(i.id) { $0.pinned.toggle() }; reload() }

    func logInteraction(_ p: Person, kind: InteractionKind = .oneOnOne) {
        _ = try? store.logInteraction(personId: p.id, kind: kind)
        reload()
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

    // MARK: snooze presets

    struct SnoozePreset: Identifiable { var id: String { label }; var label: String; var date: Date }

    func snoozePresets() -> [SnoozePreset] {
        let cal = Calendar.current
        let n = now
        func at(_ d: Date, _ h: Int, _ m: Int = 0) -> Date { cal.date(bySettingHour: h, minute: m, second: 0, of: d) ?? d }
        var out = [SnoozePreset(label: "1 hour", date: n.addingTimeInterval(3600))]
        if cal.component(.hour, from: n) < 14 { out.append(SnoozePreset(label: "This afternoon", date: at(n, 15))) }
        let tomorrow = cal.date(byAdding: .day, value: 1, to: n) ?? n
        out.append(SnoozePreset(label: "Tomorrow 09:00", date: at(tomorrow, 9)))
        let mon = cal.nextDate(after: n, matching: DateComponents(hour: 9, weekday: 2), matchingPolicy: .nextTime) ?? tomorrow
        out.append(SnoozePreset(label: "Next Monday", date: mon))
        return out
    }
}
