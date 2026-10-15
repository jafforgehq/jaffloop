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
