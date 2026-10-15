import AppKit
import Carbon.HIToolbox
import UserNotifications
import JaffloopCore

// MARK: - Global hotkey (Carbon, no dependencies)

final class HotkeyManager {
    static let defaultSpec = "opt+space"

    /// Key names used in the stored spec ("opt+cmd+j") mapped to Carbon virtual key codes.
    static let keyCodes: [String: Int] = {
        var m: [String: Int] = [
            "a": kVK_ANSI_A, "b": kVK_ANSI_B, "c": kVK_ANSI_C, "d": kVK_ANSI_D, "e": kVK_ANSI_E, "f": kVK_ANSI_F, "g": kVK_ANSI_G,
            "h": kVK_ANSI_H, "i": kVK_ANSI_I, "j": kVK_ANSI_J, "k": kVK_ANSI_K, "l": kVK_ANSI_L, "m": kVK_ANSI_M, "n": kVK_ANSI_N,
            "o": kVK_ANSI_O, "p": kVK_ANSI_P, "q": kVK_ANSI_Q, "r": kVK_ANSI_R, "s": kVK_ANSI_S, "t": kVK_ANSI_T, "u": kVK_ANSI_U,
            "v": kVK_ANSI_V, "w": kVK_ANSI_W, "x": kVK_ANSI_X, "y": kVK_ANSI_Y, "z": kVK_ANSI_Z,
            "0": kVK_ANSI_0, "1": kVK_ANSI_1, "2": kVK_ANSI_2, "3": kVK_ANSI_3, "4": kVK_ANSI_4,
            "5": kVK_ANSI_5, "6": kVK_ANSI_6, "7": kVK_ANSI_7, "8": kVK_ANSI_8, "9": kVK_ANSI_9,
            "space": kVK_Space, "return": kVK_Return, "tab": kVK_Tab,
            "f1": kVK_F1, "f2": kVK_F2, "f3": kVK_F3, "f4": kVK_F4, "f5": kVK_F5, "f6": kVK_F6,
            "f7": kVK_F7, "f8": kVK_F8, "f9": kVK_F9, "f10": kVK_F10, "f11": kVK_F11, "f12": kVK_F12,
        ]
        m["`"] = kVK_ANSI_Grave
        return m
    }()

    static func keyName(forCode code: Int) -> String? { keyCodes.first { $0.value == code }?.key }

    private var ref: EventHotKeyRef?
    private var handler: EventHandlerRef?
    var onFire: () -> Void = {}

    /// Returns false when the system refuses the combination (already taken, or an unknown key).
    @discardableResult
    func register(_ spec: String) -> Bool {
        unregister()
        let parts = spec.split(separator: "+").map(String.init)
        var mods: UInt32 = 0
        var key: UInt32?
        for p in parts {
            switch p {
            case "opt": mods |= UInt32(optionKey)
            case "cmd": mods |= UInt32(cmdKey)
            case "ctrl": mods |= UInt32(controlKey)
            case "shift": mods |= UInt32(shiftKey)
            default: key = Self.keyCodes[p].map(UInt32.init)
            }
        }
        guard let key else { return false }
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, ud in
            let me = Unmanaged<HotkeyManager>.fromOpaque(ud!).takeUnretainedValue()
            DispatchQueue.main.async { me.onFire() }
            return noErr
        }, 1, &spec, Unmanaged.passUnretained(self).toOpaque(), &handler)
        let id = EventHotKeyID(signature: OSType(0x4A4C4F50), id: 1)
        return RegisterEventHotKey(key, mods, id, GetApplicationEventTarget(), 0, &ref) == noErr
    }

    func unregister() {
        if let ref { UnregisterEventHotKey(ref); self.ref = nil }
        if let handler { RemoveEventHandler(handler); self.handler = nil }
    }
}

// MARK: - Menu bar icon

enum LoopIcon {
    /// An open ring (the loop). With a clay dot when something is overdue.
    static func image(dot: Bool) -> NSImage {
        let size = NSSize(width: 20, height: 18)
        let img = NSImage(size: size, flipped: false) { rect in
            let c = NSPoint(x: 9, y: 9), r: CGFloat = 5.8
            let path = NSBezierPath()
            path.appendArc(withCenter: c, radius: r, startAngle: 70, endAngle: 20, clockwise: false)
            path.lineWidth = 1.7; path.lineCapStyle = .round
            NSColor.labelColor.setStroke(); path.stroke()
            let tip = NSBezierPath(ovalIn: NSRect(x: c.x + r * cos(20 * .pi / 180) - 1.1, y: c.y + r * sin(20 * .pi / 180) - 1.1, width: 2.2, height: 2.2))
            NSColor.labelColor.setFill(); tip.fill()
            if dot {
                NSColor(hex: 0xE5654A).setFill()
                NSBezierPath(ovalIn: NSRect(x: 13.2, y: 11.2, width: 6, height: 6)).fill()
            }
            return true
        }
        img.isTemplate = !dot
        return img
    }
}

// MARK: - Notifications

final class NotificationService: NSObject, UNUserNotificationCenterDelegate {
    static let prefix = "jaffloop."
    var model: AppModel?
    private var center: UNUserNotificationCenter? { Bundle.main.bundleIdentifier != nil && Bundle.main.bundlePath.hasSuffix(".app") ? UNUserNotificationCenter.current() : nil }
    private var pending: DispatchWorkItem?

    func start() {
        guard let c = center else { return }
        c.delegate = self
        c.requestAuthorization(options: [.alert, .sound]) { _, _ in }
        func a(_ id: String, _ t: String) -> UNNotificationAction { UNNotificationAction(identifier: id, title: t, options: id.hasPrefix("open") ? [.foreground] : []) }
        c.setNotificationCategories([
            UNNotificationCategory(identifier: "REMINDER", actions: [a("done", "Done"), a("snooze", "Snooze 1h"), a("open", "Open")], intentIdentifiers: []),
            UNNotificationCategory(identifier: "DUE", actions: [a("openLedger", "Open ledger"), a("snoozeAll", "Snooze all")], intentIdentifiers: []),
            UNNotificationCategory(identifier: "STALE", actions: [a("received", "Mark received"), a("nudge", "Nudge"), a("snooze", "Snooze 1h")], intentIdentifiers: []),
            UNNotificationCategory(identifier: "MORNING", actions: [a("openMorning", "Open brief")], intentIdentifiers: []),
        ])
    }

    /// Debounced; called on every data change.
    func reschedule() {
        pending?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.rebuild() }
        pending = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: w)
    }

    private func rebuild() {
        guard let c = center, let model else { return }
        c.getPendingNotificationRequests { [weak self] reqs in
            guard let self else { return }
            c.removePendingNotificationRequests(withIdentifiers: reqs.map { $0.identifier }.filter { $0.hasPrefix(Self.prefix) })
            DispatchQueue.main.async { self.schedule(model, c) }
        }
    }

    private func isQuiet(_ d: Date, _ s: AppSettings, _ cal: Calendar) -> Bool {
        let wd = cal.component(.weekday, from: d)
        if wd == 1 || wd == 7 { return true }
        let (sh, sm) = AppSettings.hm(s.workStart), (eh, em) = AppSettings.hm(s.workEnd)
        let mins = cal.component(.hour, from: d) * 60 + cal.component(.minute, from: d)
        return mins < sh * 60 + sm || mins > eh * 60 + em
    }

    private func schedule(_ model: AppModel, _ c: UNUserNotificationCenter) {
        let cal = Calendar.current, now = Date(), s = model.settings
        func content(_ title: String, _ body: String, _ cat: String, thread: String, info: [String: Any] = [:]) -> UNMutableNotificationContent {
            let n = UNMutableNotificationContent(); n.title = title; n.body = body; n.categoryIdentifier = cat; n.threadIdentifier = thread; n.userInfo = info; n.sound = nil
            return n
        }
        func add(_ id: String, _ n: UNNotificationContent, at: Date) {
            let comps = cal.dateComponents([.year, .month, .day, .hour, .minute, .second], from: max(at, now.addingTimeInterval(2)))
            c.add(UNNotificationRequest(identifier: Self.prefix + id, content: n, trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)))
        }

        // 1. reminders and due times, batched into 10-minute windows
        struct Due { var item: Item; var at: Date; var explicit: Bool }
        var dues: [Due] = []
        for i in model.openItems {
            if let r = i.remindAt, r > now { dues.append(Due(item: i, at: r, explicit: true)) }
            else if i.dueHasTime, let d = i.dueAt, d > now, !isQuiet(d, s, cal) { dues.append(Due(item: i, at: d, explicit: false)) }
        }
        dues.sort { $0.at < $1.at }
        var groups: [[Due]] = []
        for d in dues { if let g = groups.last, d.at.timeIntervalSince(g[0].at) < 600 { groups[groups.count - 1].append(d) } else { groups.append([d]) } }
        for g in groups.prefix(30) {
            if g.count == 1, let d = g.first {
                let who = model.person(d.item.personId)?.name
                add("item.\(d.item.id)", content(d.item.title, who ?? "", "REMINDER", thread: "items", info: ["id": d.item.id]), at: d.at)
            } else {
                add("batch.\(g[0].item.id)", content("\(g.count) things due", g.prefix(3).map { $0.item.title }.joined(separator: " · "), "DUE", thread: "items"), at: g[0].at)
            }
        }

        // 2. due today, 16:30 weekdays (next 7 days)
        for off in 0..<7 {
            guard let day = cal.date(byAdding: .day, value: off, to: cal.startOfDay(for: now)), !isQuiet(cal.date(bySettingHour: 12, minute: 0, second: 0, of: day) ?? day, s, cal),
                  let at = cal.date(bySettingHour: 16, minute: 30, second: 0, of: day), at > now else { continue }
            let next = cal.date(byAdding: .day, value: 1, to: day)!
            let n = model.openItems.filter { $0.kind == .owe && ($0.dueAt.map { $0 >= day && $0 < next } ?? false) }.count
            if n > 0 { add("due.\(off)", content("\(n) promise\(n == 1 ? "" : "s") due today", "Still open.", "DUE", thread: "due"), at: at) }
        }

        // 3. morning brief, weekdays
        let (mh, mm) = AppSettings.hm(s.morningBrief)
        let owed = model.openItems.filter { $0.kind == .owe && Rules.isOverdue($0, now: now) }.count
        let waits = model.openItems.filter { Rules.isStaleWait($0, now: now, settings: s) }.count
        for off in 0..<7 {
            guard let day = cal.date(byAdding: .day, value: off, to: cal.startOfDay(for: now)),
                  ![1, 7].contains(cal.component(.weekday, from: day)),
                  let at = cal.date(bySettingHour: mh, minute: mm, second: 0, of: day), at > now else { continue }
            add("morning.\(off)", content("Morning brief", "\(owed) overdue promise\(owed == 1 ? "" : "s"), \(waits) stale wait\(waits == 1 ? "" : "s").", "MORNING", thread: "brief"), at: at)
        }

        // 4. stale waiting-on: once per item
        var notified = Set(UserDefaults.standard.stringArray(forKey: "staleNotified") ?? [])
        for i in model.openItems where i.kind == .wait && Rules.isStaleWait(i, now: now, settings: s) && !notified.contains(i.id) {
            let who = model.person(i.personId)?.name.split(separator: " ").first.map(String.init) ?? "Someone"
            var at = now.addingTimeInterval(30)
            if isQuiet(at, s, cal) { at = nextWorkStart(after: now, s, cal) }
            add("stale.\(i.id)", content("\(who) hasn't sent \(i.title)", "Waiting since \(Fmt.short(i.createdAt, "d MMM")).", "STALE", thread: "stale", info: ["id": i.id]), at: at)
            notified.insert(i.id)
        }
        UserDefaults.standard.set(Array(notified), forKey: "staleNotified")
    }

    private func nextWorkStart(after d: Date, _ s: AppSettings, _ cal: Calendar) -> Date {
        let (h, m) = AppSettings.hm(s.workStart)
        var day = cal.startOfDay(for: d)
        for _ in 0..<8 {
            if let t = cal.date(bySettingHour: h, minute: m, second: 0, of: day), t > d, ![1, 7].contains(cal.component(.weekday, from: t)) { return t }
            day = cal.date(byAdding: .day, value: 1, to: day)!
        }
        return d.addingTimeInterval(3600)
    }

    // MARK: delegate

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions { [.banner, .list] }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive r: UNNotificationResponse) async {
        let info = r.notification.request.content.userInfo
        let action = r.actionIdentifier
        await MainActor.run {
            guard let model else { return }
            let item = (info["id"] as? String).flatMap { try? model.store.item($0) } ?? nil
            switch action {
            case "done", "received": if let item { model.complete(item) }
            case "snooze": if let item { model.snooze(item, until: Date().addingTimeInterval(3600)) }
            case "snoozeAll":
                for i in model.openItems where i.kind == .owe && Rules.isOverdue(i, now: Date()) || (i.kind == .owe && (i.dueAt.map { Calendar.current.isDateInToday($0) } ?? false)) { model.snooze(i, until: Date().addingTimeInterval(3600)) }
            case "nudge":
                if let item, let p = model.person(item.personId) {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString("Hi \(p.name.split(separator: " ").first.map(String.init) ?? p.name), quick check-in on \(item.title). Any update?", forType: .string)
                }
            case "openLedger": model.nav = .ledger; model.openMain()
            case "openMorning": model.openMorningBrief()
            default:
                if let item, let pid = item.personId { model.nav = .person(pid) } else { model.nav = .today }
                model.openMain()
            }
        }
    }
}
