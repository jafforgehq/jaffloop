import Foundation

/// Dotted version such as "0.0.3" or "v1.2". Anything that is not numeric makes it invalid ("dev").
public struct AppVersion: Comparable, CustomStringConvertible {
    public let parts: [Int]

    public init?(_ s: String) {
        let t = s.trimmingCharacters(in: .whitespaces).drop(while: { $0 == "v" || $0 == "V" })
        let p = t.split(separator: ".").map { Int($0.prefix(while: \.isNumber)) }
        guard !p.isEmpty, !p.contains(where: { $0 == nil }) else { return nil }
        parts = p.compactMap { $0 }
    }

    public var description: String { parts.map(String.init).joined(separator: ".") }

    public static func < (a: AppVersion, b: AppVersion) -> Bool {
        for i in 0..<max(a.parts.count, b.parts.count) {
            let x = i < a.parts.count ? a.parts[i] : 0, y = i < b.parts.count ? b.parts[i] : 0
            if x != y { return x < y }
        }
        return false
    }
    public static func == (a: AppVersion, b: AppVersion) -> Bool { !(a < b) && !(b < a) }
}

/// Date patterns in the app are written with a 24-hour clock ("EEE HH:mm"); this swaps in the
/// user's own clock style (12 or 24 hour) from their locale.
public enum TimeFormat {
    public static func localize(_ pattern: String, locale: Locale = .current) -> String {
        guard pattern.contains("HH:mm") else { return pattern }
        let template = pattern.replacingOccurrences(of: "HH:mm", with: "jmm").filter { $0 != " " && $0 != "," }
        return DateFormatter.dateFormat(fromTemplate: template, options: 0, locale: locale) ?? pattern
    }
}

public enum PeopleOrder {
    /// Pinned people first, then people past their 1:1 cadence (most overdue first), then by name.
    public static func sorted(_ s: [PersonSummary], pinned: Set<String>) -> [PersonSummary] {
        func urgency(_ x: PersonSummary) -> Int {
            guard x.cadenceOverdue, let c = x.person.cadenceDays else { return -1 }
            return (x.daysSinceLast ?? c * 2) - c      // never met counts as twice the cadence
        }
        return s.sorted { a, b in
            let pa = pinned.contains(a.person.id), pb = pinned.contains(b.person.id)
            if pa != pb { return pa }
            let ua = urgency(a), ub = urgency(b)
            if ua != ub { return ua > ub }
            return a.person.name.localizedCaseInsensitiveCompare(b.person.name) == .orderedAscending
        }
    }
}

public enum CadenceStrip {
    /// One flag per week, oldest first, ending with the current week: was there a 1:1 that week?
    public static func weeks(_ dates: [Date], now: Date, count: Int = 12, calendar: Calendar = .current) -> [Bool] {
        guard let thisWeek = calendar.dateInterval(of: .weekOfYear, for: now)?.start else { return Array(repeating: false, count: count) }
        return (0..<count).map { i in
            let back = count - 1 - i
            guard let start = calendar.date(byAdding: .weekOfYear, value: -back, to: thisWeek),
                  let end = calendar.date(byAdding: .weekOfYear, value: 1, to: start) else { return false }
            return dates.contains { $0 >= start && $0 < end }
        }
    }
}

public enum ItemAge {
    /// Whole days since creation, for the "12d" badge on owes and waits. nil under `minDays`.
    public static func badge(_ i: Item, now: Date, minDays: Int = 3, calendar: Calendar = .current) -> Int? {
        guard i.kind == .owe || i.kind == .wait else { return nil }
        let d = calendar.dateComponents([.day], from: calendar.startOfDay(for: i.createdAt), to: calendar.startOfDay(for: now)).day ?? 0
        return d >= minDays ? d : nil
    }
}

public extension ItemAge {
    /// 0 = fresh, 1 = a week or more, 2 = two weeks or more. Drives the badge colour.
    static func level(days: Int) -> Int { days >= 14 ? 2 : (days >= 7 ? 1 : 0) }
}

public enum RecurrenceText {
    /// Human wording for the stored recurrence rule ("FREQ=WEEKLY;BYDAY=MO" -> "every Mon").
    public static func describe(_ r: String) -> String {
        if r.contains("BYDAY=MO,TU,WE,TH,FR") { return "weekdays" }
        let days = ["MO": "Mon", "TU": "Tue", "WE": "Wed", "TH": "Thu", "FR": "Fri", "SA": "Sat", "SU": "Sun"]
        if let d = r.components(separatedBy: "BYDAY=").last, r.contains("BYDAY"), let n = days[d] { return "every \(n)" }
        if r.contains("INTERVAL="), let n = r.components(separatedBy: "INTERVAL=").last?.components(separatedBy: ";").first {
            return "every \(n) \(r.contains("WEEKLY") ? "weeks" : r.contains("MONTHLY") ? "months" : "days")"
        }
        return r.contains("MONTHLY") ? "monthly" : r.contains("DAILY") ? "daily" : "weekly"
    }
}

public enum QueryTerms {
    /// The plain words of a search query, without filters like @person, kind:owe, before:2026-11-01.
    public static func words(_ q: String) -> [String] {
        q.split(separator: " ").map(String.init).filter { w in
            !w.hasPrefix("@") && !w.contains(":") && w.count > 1
        }.map { $0.lowercased() }
    }
}

/// Back and forward through visited screens.
public struct NavHistory<T: Equatable> {
    public private(set) var back: [T] = []
    public private(set) var forward: [T] = []
    public init() {}
    public var canGoBack: Bool { !back.isEmpty }
    public var canGoForward: Bool { !forward.isEmpty }

    public mutating func visit(from old: T, to new: T) {
        guard old != new else { return }
        back.append(old); forward.removeAll()
        if back.count > 50 { back.removeFirst() }
    }
    public mutating func goBack(from current: T) -> T? {
        guard let p = back.popLast() else { return nil }
        forward.append(current); return p
    }
    public mutating func goForward(from current: T) -> T? {
        guard let n = forward.popLast() else { return nil }
        back.append(current); return n
    }
}

public enum PinOrder {
    /// Pinned items first, in the saved order (unknown ones keep their place after the known ones); the rest unchanged.
    public static func apply(_ items: [Item], order: [String]) -> [Item] {
        let pinned = items.filter { $0.pinned }
        let rest = items.filter { !$0.pinned }
        let rank = Dictionary(uniqueKeysWithValues: order.enumerated().map { ($1, $0) })
        let sorted = pinned.enumerated().sorted { a, b in
            let ra = rank[a.element.id] ?? Int.max, rb = rank[b.element.id] ?? Int.max
            return ra != rb ? ra < rb : a.offset < b.offset
        }.map { $0.element }
        return sorted + rest
    }

    /// New saved order after dragging `id` onto `target`: it takes the target's place.
    public static func move(_ id: String, onto target: String, in current: [String]) -> [String] {
        guard id != target else { return current }
        var o = current.filter { $0 != id }
        if let i = o.firstIndex(of: target) { o.insert(id, at: i) } else { o.append(id) }
        return o
    }
}
