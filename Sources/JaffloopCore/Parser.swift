import Foundation

public struct ParsedToken: Equatable {
    public enum Role: String { case kind, person, date, recurrence, tag, pin, remind, quote }
    public var role: Role
    public var range: NSRange
    public var text: String
}

public struct ParsedCapture: Equatable {
    public var kind: ItemKind = .task
    public var kindExplicit = false
    public var personHandle: String?
    public var title = ""
    public var quote: String?
    public var dueAt: Date?
    public var dueHasTime = false
    public var remindAt: Date?
    public var recurRule: String?
    public var tags: [String] = []
    public var pinned = false
    public var tokens: [ParsedToken] = []
    /// True for items with neither a date nor a person (task/owe/wait/bring only).
    public var inbox: Bool {
        guard [.task, .owe, .wait, .bring].contains(kind) else { return false }
        return dueAt == nil && personHandle == nil
    }
}

/// Deterministic, offline parser for the one-line capture grammar.
/// `[prefix] [@person] text [date] [recurrence] [#tag] [!]`
public enum CaptureParser {
    public static let prefixes: [String: ItemKind] = [
        "owe": .owe, "o": .owe, "wait": .wait, "w": .wait, "bring": .bring, "b": .bring,
        "todo": .task, "t": .task, "said": .said, "s": .said, "note": .note, "n": .note,
    ]
    static let weekdays: [String: Int] = [
        "sun": 1, "sunday": 1, "mon": 2, "monday": 2, "tue": 3, "tues": 3, "tuesday": 3,
        "wed": 4, "wednesday": 4, "thu": 5, "thur": 5, "thurs": 5, "thursday": 5,
        "fri": 6, "friday": 6, "sat": 7, "saturday": 7,
    ]
    static let rruleDay = [1: "SU", 2: "MO", 3: "TU", 4: "WE", 5: "TH", 6: "FR", 7: "SA"]
    static let months: [String: Int] = [
        "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3, "apr": 4, "april": 4,
        "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7, "aug": 8, "august": 8,
        "sep": 9, "sept": 9, "september": 9, "oct": 10, "october": 10, "nov": 11, "november": 11,
        "dec": 12, "december": 12,
    ]

    struct Tok { var text: String; var range: NSRange; var used = false }

    public static func parse(_ input: String, now: Date = Date(), calendar: Calendar = .current,
                             eod: (Int, Int) = (17, 30)) -> ParsedCapture {
        var out = ParsedCapture()
        let ns = input as NSString
        var toks: [Tok] = []
        var quoteRange: NSRange?

        // 1. tokenise on whitespace
        var i = 0
        while i < ns.length {
            let c = ns.character(at: i)
            if CharacterSet.whitespacesAndNewlines.contains(Unicode.Scalar(c) ?? " ") { i += 1; continue }
            var j = i
            while j < ns.length, !CharacterSet.whitespacesAndNewlines.contains(Unicode.Scalar(ns.character(at: j)) ?? " ") { j += 1 }
            toks.append(Tok(text: ns.substring(with: NSRange(location: i, length: j - i)), range: NSRange(location: i, length: j - i)))
            i = j
        }

        func use(_ idx: Int, _ role: ParsedToken.Role) {
            toks[idx].used = true
            out.tokens.append(ParsedToken(role: role, range: toks[idx].range, text: toks[idx].text))
        }

        // 2. prefix
        if let first = toks.first, let k = prefixes[first.text.lowercased()], toks.count > 1 || first.text.count > 2 {
            out.kind = k; out.kindExplicit = true
            use(0, .kind)
        }

        // 3. quote (said only): first "..." pair
        if out.kind == .said, out.kindExplicit,
           let re = try? NSRegularExpression(pattern: "[\"\u{201C}]([^\"\u{201D}]*)[\"\u{201D}]"),
           let m = re.firstMatch(in: input, range: NSRange(location: 0, length: ns.length)) {
            quoteRange = m.range
            out.quote = ns.substring(with: m.range(at: 1))
            out.tokens.append(ParsedToken(role: .quote, range: m.range, text: ns.substring(with: m.range)))
            for idx in toks.indices where NSIntersectionRange(toks[idx].range, m.range).length > 0 { toks[idx].used = true }
        }
        _ = quoteRange

        // 4. person, tags, pin
        for idx in toks.indices where !toks[idx].used {
            let t = toks[idx].text
            if out.personHandle == nil, t.hasPrefix("@"), t.count > 1 {
                let handle = String(t.dropFirst()).trimmingCharacters(in: CharacterSet(charactersIn: ",.:;!?"))
                if !handle.isEmpty, handle.range(of: "^[A-Za-z0-9_.-]+$", options: .regularExpression) != nil {
                    out.personHandle = handle.lowercased()
                    toks[idx].used = true
                    out.tokens.append(ParsedToken(role: .person, range: NSRange(location: toks[idx].range.location, length: handle.utf16.count + 1), text: "@" + handle))
                }
            } else if t.hasPrefix("#"), t.count > 1, t.dropFirst().range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil {
                out.tags.append(String(t.dropFirst()).lowercased()); use(idx, .tag)
            } else if t == "!" {
                out.pinned = true; use(idx, .pin)
            }
        }

        // 5. date machinery
        let today = calendar.startOfDay(for: now)
        func addDays(_ d: Date, _ n: Int) -> Date { calendar.date(byAdding: .day, value: n, to: d) ?? d }
        func nextWeekday(_ wd: Int, nextWeek: Bool) -> Date {
            if nextWeek {
                let weekEnd = calendar.dateInterval(of: .weekOfYear, for: now)?.end ?? addDays(today, 7)
                return calendar.nextDate(after: weekEnd.addingTimeInterval(-1), matching: DateComponents(weekday: wd), matchingPolicy: .nextTime) ?? today
            }
            return calendar.nextDate(after: today, matching: DateComponents(weekday: wd), matchingPolicy: .nextTime) ?? today
        }
        func timeOf(_ s: String) -> (Int, Int)? {
            let l = s.lowercased()
            guard let m = try? NSRegularExpression(pattern: "^(\\d{1,2})(?::(\\d{2}))?(am|pm)?$").firstMatch(in: l, range: NSRange(location: 0, length: (l as NSString).length)) else { return nil }
            let ls = l as NSString
            let hasColon = m.range(at: 2).location != NSNotFound
            let ap = m.range(at: 3).location != NSNotFound ? ls.substring(with: m.range(at: 3)) : nil
            guard hasColon || ap != nil else { return nil }
            var h = Int(ls.substring(with: m.range(at: 1))) ?? 99
            let mi = hasColon ? Int(ls.substring(with: m.range(at: 2))) ?? 99 : 0
            if let ap { guard (1...12).contains(h) else { return nil }; if ap == "pm", h < 12 { h += 12 }; if ap == "am", h == 12 { h = 0 } }
            guard h < 24, mi < 60 else { return nil }
            return (h, mi)
        }
        func duration(_ s: String) -> TimeInterval? {
            guard let m = try? NSRegularExpression(pattern: "^(\\d+)(m|min|h|hr|d)$").firstMatch(in: s.lowercased(), range: NSRange(location: 0, length: (s as NSString).length)) else { return nil }
            let l = s.lowercased() as NSString
            let n = Double(l.substring(with: m.range(at: 1))) ?? 0
            switch l.substring(with: m.range(at: 2)) {
            case "m", "min": return n * 60
            case "h", "hr": return n * 3600
            default: return n * 86400
            }
        }
        func unitSeconds(_ s: String) -> TimeInterval? {
            switch s.lowercased() {
            case "min", "mins", "minute", "minutes": return 60
            case "h", "hr", "hrs", "hour", "hours": return 3600
            case "d", "day", "days": return 86400
            default: return nil
            }
        }

        struct DatePick { var day: Date?; var time: (Int, Int)?; var absolute: Date?; var absHasTime = true; var eodToday = false }

        /// Scans unused tokens in `range` for one date phrase. Marks consumed tokens.
        func scanDate(from start: Int, onlyFirstUnusedRun: Bool = false) -> DatePick {
            var pick = DatePick()
            var idx = start
            while idx < toks.count {
                if toks[idx].used { if onlyFirstUnusedRun, pick.day != nil || pick.time != nil || pick.absolute != nil { break }; idx += 1; continue }
                let t = toks[idx].text.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ",."))
                let nextT: String? = idx + 1 < toks.count && !toks[idx + 1].used ? toks[idx + 1].text.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ",.")) : nil
                let next2: String? = idx + 2 < toks.count && !toks[idx + 2].used ? toks[idx + 2].text.lowercased() : nil
                // in 2h / in 2 hours
                if t == "in", let n = nextT, pick.absolute == nil {
                    if let d = duration(n) {
                        pick.absolute = now.addingTimeInterval(d); pick.absHasTime = !n.hasSuffix("d")
                        use(idx, .date); use(idx + 1, .date); idx += 2; continue
                    }
                    if let num = Double(n), let u = next2.flatMap(unitSeconds) {
                        pick.absolute = now.addingTimeInterval(num * u); pick.absHasTime = u < 86400
                        use(idx, .date); use(idx + 1, .date); use(idx + 2, .date); idx += 3; continue
                    }
                }
                if t == "at", let n = nextT, pick.time == nil, let tm = timeOf(n) {
                    pick.time = tm; use(idx, .date); use(idx + 1, .date); idx += 2; continue
                }
                if t == "next", let n = nextT, pick.day == nil, let wd = weekdays[n] {
                    pick.day = nextWeekday(wd, nextWeek: true); use(idx, .date); use(idx + 1, .date); idx += 2; continue
                }
                if pick.day == nil, pick.absolute == nil {
                    if t == "today" { pick.day = today; use(idx, .date); idx += 1; continue }
                    if t == "tomorrow" || t == "tmr" || t == "tmrw" { pick.day = addDays(today, 1); use(idx, .date); idx += 1; continue }
                    if let wd = weekdays[t] { pick.day = nextWeekday(wd, nextWeek: false); use(idx, .date); idx += 1; continue }
                    if t == "eow" { pick.day = nextWeekday(6, nextWeek: false); if calendar.component(.weekday, from: today) == 6 { pick.day = today }
                        pick.time = pick.time ?? eod; use(idx, .date); idx += 1; continue }
                    // 15 nov / nov 15
                    if let d = Int(t), (1...31).contains(d), let n = nextT, let mo = months[n] {
                        pick.day = resolveMonthDay(mo, d); use(idx, .date); use(idx + 1, .date); idx += 2; continue
                    }
                    if let mo = months[t], let n = nextT, let d = Int(n), (1...31).contains(d) {
                        pick.day = resolveMonthDay(mo, d); use(idx, .date); use(idx + 1, .date); idx += 2; continue
                    }
                }
                if t == "eod", pick.time == nil { pick.time = eod; pick.eodToday = true; use(idx, .date); idx += 1; continue }
                if pick.time == nil, pick.absolute == nil, let tm = timeOf(t) { pick.time = tm; use(idx, .date); idx += 1; continue }
                idx += 1
            }
            return pick
        }
        func resolveMonthDay(_ mo: Int, _ d: Int) -> Date? {
            var c = calendar.dateComponents([.year], from: today)
            c.month = mo; c.day = d
            guard var date = calendar.date(from: c) else { return nil }
            if date < today { c.year! += 1; date = calendar.date(from: c) ?? date }
            return date
        }
        func resolve(_ p: DatePick) -> (Date, Bool)? {
            if let a = p.absolute { return p.absHasTime ? (a, true) : (calendar.startOfDay(for: a), false) }
            switch (p.day, p.time) {
            case let (d?, t?): return (calendar.date(bySettingHour: t.0, minute: t.1, second: 0, of: d) ?? d, true)
            case let (d?, nil): return (d, false)
            case let (nil, t?):
                var c = calendar.date(bySettingHour: t.0, minute: t.1, second: 0, of: today) ?? today
                if c <= now { c = addDays(c, 1) }
                return (c, true)
            default: return nil
            }
        }

        // 5a. remind
        if let ri = toks.indices.first(where: { !toks[$0].used && toks[$0].text.lowercased() == "remind" }), ri + 1 < toks.count {
            use(ri, .remind)
            let n = toks[ri + 1].text
            if !toks[ri + 1].used, let d = duration(n) {
                out.remindAt = now.addingTimeInterval(d); use(ri + 1, .remind)
            } else {
                let p = scanDate(from: ri + 1, onlyFirstUnusedRun: true)
                if let (d, _) = resolve(p) { out.remindAt = d }
            }
        }

        // 5b. recurrence
        var recurTime: (Int, Int)?
        var recurFirst: Date?
        for idx in toks.indices where !toks[idx].used && out.recurRule == nil {
            let t = toks[idx].text.lowercased()
            let nx = idx + 1 < toks.count && !toks[idx + 1].used ? toks[idx + 1].text.lowercased() : nil
            var consumed = 0
            var rule: String?
            var first: Date?
            if t == "every", let nx {
                if let wd = weekdays[nx] { rule = "FREQ=WEEKLY;BYDAY=\(rruleDay[wd]!)"; first = nextWeekday(wd, nextWeek: false); consumed = 2 }
                else if nx == "weekday" || nx == "weekdays" { rule = "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"; consumed = 2 }
                else if ["day", "week", "month"].contains(nx) { rule = "FREQ=\(["day": "DAILY", "week": "WEEKLY", "month": "MONTHLY"][nx]!)"; consumed = 2 }
                else if let n = Int(nx), n > 0, idx + 2 < toks.count, !toks[idx + 2].used {
                    let u = toks[idx + 2].text.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ",."))
                    let f = ["day": "DAILY", "days": "DAILY", "week": "WEEKLY", "weeks": "WEEKLY", "month": "MONTHLY", "months": "MONTHLY"][u]
                    if let f { rule = "FREQ=\(f);INTERVAL=\(n)"; consumed = 3 }
                }
            } else if t == "monthly" { rule = "FREQ=MONTHLY"; consumed = 1 }
            else if t == "weekly" { rule = "FREQ=WEEKLY"; consumed = 1 }
            else if t == "daily" { rule = "FREQ=DAILY"; consumed = 1 }
            else if t == "weekdays" { rule = "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"; consumed = 1 }
            if let rule {
                out.recurRule = rule
                for k in 0..<consumed { use(idx + k, .recurrence) }
                // optional time right after
                let after = idx + consumed
                if after < toks.count, !toks[after].used, let tm = timeOf(toks[after].text) { recurTime = tm; use(after, .recurrence) }
                recurFirst = first
            }
        }

        // 5c. due date
        let pick = scanDate(from: 0)
        if let (d, hasTime) = resolve(pick) {
            out.dueAt = d; out.dueHasTime = hasTime
        } else if out.recurRule != nil {
            // first occurrence of the recurrence
            let rule = out.recurRule!
            var day = recurFirst ?? today
            if recurFirst == nil {
                if rule.contains("BYDAY=MO,TU,WE,TH,FR") {
                    if !(2...6).contains(calendar.component(.weekday, from: today)) { day = Recurrence.next(after: today, rule: rule, calendar: calendar) ?? today }
                }
                else if rule.contains("MONTHLY") { day = calendar.date(byAdding: .month, value: 1, to: today) ?? today }
                else if rule.contains("WEEKLY") { day = addDays(today, 7 * (Int(rule.components(separatedBy: "INTERVAL=").last ?? "") ?? 1)) }
                else if rule.contains("DAILY") { day = today }
            }
            if let tm = recurTime {
                var d = calendar.date(bySettingHour: tm.0, minute: tm.1, second: 0, of: day) ?? day
                if d <= now { d = Recurrence.next(after: d, rule: rule, calendar: calendar) ?? addDays(d, 1) }
                out.dueAt = d; out.dueHasTime = true
            } else { out.dueAt = day; out.dueHasTime = false }
        }

        // 6. title: unused tokens in original order
        let kept = toks.filter { !$0.used }.map { $0.text }
        out.title = kept.joined(separator: " ")
        if out.title.isEmpty, let q = out.quote { out.title = q }
        if !out.kindExplicit { out.kind = out.personHandle != nil ? .bring : .task }
        out.tokens.sort { $0.range.location < $1.range.location }
        return out
    }
}

/// Minimal RRULE support: DAILY / WEEKLY(BYDAY, INTERVAL) / MONTHLY(INTERVAL).
public enum Recurrence {
    public static func next(after date: Date, rule: String, calendar: Calendar = .current) -> Date? {
        var parts: [String: String] = [:]
        for kv in rule.split(separator: ";") { let p = kv.split(separator: "=", maxSplits: 1); if p.count == 2 { parts[String(p[0])] = String(p[1]) } }
        let n = max(1, Int(parts["INTERVAL"] ?? "1") ?? 1)
        func add(_ c: Calendar.Component, _ v: Int) -> Date? { calendar.date(byAdding: c, value: v, to: date) }
        switch parts["FREQ"] {
        case "DAILY": return add(.day, n)
        case "MONTHLY": return add(.month, n)
        case "WEEKLY":
            guard let by = parts["BYDAY"] else { return add(.day, 7 * n) }
            let names = Set(by.split(separator: ",").map(String.init))
            let days = Dictionary(uniqueKeysWithValues: CaptureParser.rruleDay.map { ($1, $0) })
            let wds = Set(names.compactMap { days[$0] })
            if wds.count == 1 { return add(.day, 7 * n) }
            for d in 1...7 {
                if let c = calendar.date(byAdding: .day, value: d, to: date), wds.contains(calendar.component(.weekday, from: c)) { return c }
            }
            return nil
        default: return nil
        }
    }

    /// Next occurrence strictly in the future of `now`.
    public static func nextFuture(from due: Date, rule: String, now: Date, calendar: Calendar = .current) -> Date? {
        var d = due
        for _ in 0..<500 {
            guard let n = next(after: d, rule: rule, calendar: calendar) else { return nil }
            d = n
            if d > now { return d }
        }
        return d
    }
}
