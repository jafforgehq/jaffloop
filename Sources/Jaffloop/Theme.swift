import SwiftUI
import AppKit
import JaffloopCore

extension Color {
    /// Appearance-aware colour from two hex values.
    init(dark: UInt32, light: UInt32) {
        self.init(nsColor: NSColor(name: nil) { a in
            let isDark = a.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            return NSColor(hex: isDark ? dark : light)
        })
    }
}

extension NSColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(srgbRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: alpha)
    }
}

enum Theme {
    static let bg = Color(dark: 0x121211, light: 0xF5F3EF)
    static let surface = Color(dark: 0x191918, light: 0xFBFAF8)
    static let elevated = Color(dark: 0x232322, light: 0xFFFFFF)
    static let text = Color(dark: 0xEDEBE6, light: 0x1C1B19)
    static let text2 = Color(dark: 0x8F8C85, light: 0x6B6860)
    static let hairline = Color(nsColor: NSColor(name: nil) { a in
        a.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(white: 1, alpha: 0.075) : NSColor(white: 0, alpha: 0.09)
    })
    static let hover = Color(nsColor: NSColor(name: nil) { a in
        a.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(white: 1, alpha: 0.05) : NSColor(white: 0, alpha: 0.04)
    })
    static let clay = Color(dark: 0xE5654A, light: 0xC94A2E)
    static let avatar = Color(dark: 0x2B2A28, light: 0xE7E4DC)

    static func kind(_ k: ItemKind) -> Color {
        switch k {
        case .owe: return Color(dark: 0xC9A46A, light: 0xA9803F)
        case .wait: return Color(dark: 0x7E9DB5, light: 0x4F7391)
        case .bring: return Color(dark: 0xA294B8, light: 0x7C6B96)
        case .task: return Color(dark: 0x8A877F, light: 0x77746C)
        case .said: return Color(dark: 0x8DAE98, light: 0x5E8A6F)
        case .note: return Color(dark: 0x8A877F, light: 0x77746C)
        }
    }

    static func title(_ size: CGFloat = 30) -> Font { .system(size: size, weight: .semibold, design: .serif) }
    static let row = Font.system(size: 13)
    static let mono = Font.system(size: 10.5, weight: .medium, design: .monospaced)
    static let date = Font.system(size: 11.5).monospacedDigit()
}

enum Motion {
    static var reduced: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
    static func spring(_ d: Double = 0.28) -> Animation { reduced ? .easeInOut(duration: 0.12) : .spring(response: d, dampingFraction: 0.8) }
    static func ease(_ d: Double = 0.22) -> Animation { .easeInOut(duration: reduced ? 0.12 : d) }
}

/// Date formatting that matches the mocks: "Fri", "Fri 10:00", "Oct 15".
enum Fmt {
    static func due(_ i: Item, now: Date = Date(), cal: Calendar = .current) -> String? {
        guard let d = i.dueAt else { return nil }
        let f = DateFormatter(); f.calendar = cal
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: now), to: cal.startOfDay(for: d)).day ?? 0
        var day: String
        switch days {
        case 0: day = "Today"
        case 1: day = "Tomorrow"
        case -1: day = "Yesterday"
        case 2...6: f.dateFormat = "EEE"; day = f.string(from: d)
        case let n where n < -1 && n > -7: f.dateFormat = "EEE"; day = f.string(from: d)
        default: f.dateFormat = "MMM d"; day = f.string(from: d)
        }
        if i.dueHasTime { f.dateFormat = "HH:mm"; day += " " + f.string(from: d) }
        return day
    }

    static func short(_ d: Date, _ fmt: String) -> String {
        let f = DateFormatter(); f.dateFormat = fmt; return f.string(from: d)
    }

    static func backLabel(_ d: Date, now: Date = Date(), cal: Calendar = .current) -> String {
        let f = DateFormatter(); f.calendar = cal
        if cal.isDate(d, inSameDayAs: now) { f.dateFormat = "HH:mm"; return "back " + f.string(from: d) }
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: now), to: cal.startOfDay(for: d)).day ?? 0
        if days == 1 { f.dateFormat = "HH:mm"; return "back tomorrow \(f.string(from: d))" }
        f.dateFormat = "EEE"; return "back " + f.string(from: d)
    }
}
