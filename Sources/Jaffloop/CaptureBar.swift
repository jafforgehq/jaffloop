import SwiftUI
import AppKit
import JaffloopCore

// MARK: - Panel

/// Non-activating floating panel so the previous app keeps focus while you type.
final class CapturePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    convenience init(model: AppModel, onClose: @escaping () -> Void) {
        self.init(contentRect: NSRect(x: 0, y: 0, width: 640, height: 300),
                  styleMask: [.nonactivatingPanel, .borderless, .fullSizeContentView],
                  backing: .buffered, defer: false)
        isFloatingPanel = true
        level = .floating
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        hidesOnDeactivate = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        let host = NSHostingView(rootView: CaptureView(onClose: onClose).environmentObject(model))
        host.sizingOptions = []
        contentView = host
    }

    func present() {
        let screen = NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) } ?? NSScreen.main
        if let f = screen?.visibleFrame {
            setFrameOrigin(NSPoint(x: f.midX - frame.width / 2, y: f.maxY - f.height * 0.28 - frame.height + 60))
        }
        NotificationCenter.default.post(name: .captureWillShow, object: nil)
        makeKeyAndOrderFront(nil)
    }
}

extension Notification.Name {
    static let captureWillShow = Notification.Name("jaffloop.captureWillShow")
}

// MARK: - View

struct CaptureView: View {
    @EnvironmentObject var model: AppModel
    var onClose: () -> Void
    var preset: String?          // snapshot mode
    @State private var text = ""
    @State private var shown = false
    @State private var saving = false
    @State private var suggestionIndex = 0
    @State private var cursorToEnd = 0

    private var parsed: ParsedCapture {
        CaptureParser.parse(text, now: Date(), eod: AppSettings.hm(model.settings.eodTime))
    }

    /// The `@token` being typed at the end of the line, if any.
    private var atQuery: String? {
        guard let last = text.split(separator: " ", omittingEmptySubsequences: false).last, last.hasPrefix("@"), !text.hasSuffix(" ") else { return nil }
        return String(last.dropFirst()).lowercased()
    }

    private var suggestions: [Person] {
        guard let q = atQuery else { return [] }
        let all = model.summaries.map { $0.person }
        return Array((q.isEmpty ? all : all.filter { $0.handle.hasPrefix(q) || $0.name.lowercased().hasPrefix(q) || $0.name.lowercased().contains(" " + q) }).prefix(4))
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    LoopRing(size: 20, lineWidth: 2).opacity(0.7)
                    if preset != nil {
                        Text(highlighted(text)).font(.system(size: 20)).frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        CaptureField(text: $text, placeholder: "owe @sara review RFC fri", parse: { CaptureParser.parse($0, now: Date()) },
                                     onSubmit: { stay in submit(stay: stay) }, onEscape: { dismiss() },
                                     onUp: { if text.isEmpty { text = model.lastCapture; cursorToEnd += 1 } else { suggestionIndex = max(0, suggestionIndex - 1) } },
                                     onDown: { suggestionIndex = min(max(0, suggestions.count - 1), suggestionIndex + 1) },
                                     onTab: { complete() }, moveToEnd: cursorToEnd)
                            .frame(height: 28)
                    }
                    Kbd("⏎")
                }
                .padding(.horizontal, 18).padding(.vertical, 16)

                if !text.isEmpty {
                    Rectangle().fill(Theme.hairline).frame(height: 0.5)
                    chips.padding(.horizontal, 18).padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if !suggestions.isEmpty || (atQuery != nil && !(atQuery ?? "").isEmpty) { suggestionList }
                } else {
                    Rectangle().fill(Theme.hairline).frame(height: 0.5)
                    HStack(spacing: 14) {
                        hint("owe", "you promised"); hint("wait", "they promised"); hint("bring", "talking point")
                        hint("todo", "your task"); hint("said", "log a quote"); hint("note", "a fact")
                    }.padding(.horizontal, 18).padding(.vertical, 10).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .background(
                RoundedRectangle(cornerRadius: 16).fill(model.snapshot ? AnyShapeStyle(Theme.elevated) : AnyShapeStyle(.clear))
                    .background(model.snapshot ? AnyView(EmptyView()) : AnyView(VisualEffect(material: .hudWindow, blending: .behindWindow).clipShape(RoundedRectangle(cornerRadius: 16))))
            )
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.hairline, lineWidth: 0.5))
            .shadow(color: .black.opacity(0.35), radius: 28, y: 14)
            .scaleEffect(saving ? 0.94 : (shown || preset != nil ? 1 : 0.96))
            .opacity(saving ? 0 : (shown || preset != nil ? 1 : 0))
            .padding(.horizontal, 30).padding(.top, 20)
            Spacer(minLength: 0)
        }
        .animation(.spring(response: 0.14, dampingFraction: 0.85), value: shown)
        .animation(.easeIn(duration: 0.16), value: saving)
        .onAppear { if let preset { text = preset } ; shown = true }
        .onReceive(NotificationCenter.default.publisher(for: .captureWillShow)) { _ in
            text = ""; saving = false; shown = false
            DispatchQueue.main.async { shown = true }
        }
    }

    // MARK: pieces

    func hint(_ k: String, _ d: String) -> some View {
        HStack(spacing: 5) { Text(k).font(Theme.mono).foregroundStyle(Theme.text); Text(d).font(.system(size: 11.5)).foregroundStyle(Theme.text2) }
    }

    @ViewBuilder var chips: some View {
        let p = parsed
        let person = p.personHandle.flatMap { h in model.summaries.first { $0.person.handle == h }?.person }
        HStack(spacing: 6) {
            Chip { Circle().fill(Theme.kind(p.kind)).frame(width: 6, height: 6); Text(p.kind.rawValue).font(Theme.mono) }
                .transition(.scale(scale: 0.9).combined(with: .opacity))
            if let h = p.personHandle {
                Chip {
                    if let person { Avatar(person: person, size: 14); Text(person.name) }
                    else { Image(systemName: "plus").font(.system(size: 9)); Text("create \(h.capitalized)") }
                }.transition(.scale(scale: 0.9).combined(with: .opacity))
            }
            if let d = p.dueAt {
                Chip {
                    Image(systemName: "calendar").font(.system(size: 10)).foregroundStyle(Theme.text2)
                    Text(dueText(d, time: p.dueHasTime)).monospacedDigit()
                }.transition(.scale(scale: 0.9).combined(with: .opacity))
            }
            if let r = p.recurRule { Chip { Image(systemName: "repeat").font(.system(size: 10)); Text(recurText(r)) }.transition(.scale(scale: 0.9).combined(with: .opacity)) }
            if let r = p.remindAt { Chip { Image(systemName: "bell").font(.system(size: 10)); Text(Fmt.short(r, "EEE HH:mm")) }.transition(.scale(scale: 0.9).combined(with: .opacity)) }
            ForEach(p.tags, id: \.self) { t in Chip { Text("#\(t)") }.transition(.scale(scale: 0.9).combined(with: .opacity)) }
            if p.pinned { Chip { Image(systemName: "pin.fill").font(.system(size: 9)); Text("pinned") }.transition(.scale(scale: 0.9).combined(with: .opacity)) }
            if p.inbox { Chip { Image(systemName: "tray").font(.system(size: 10)); Text("inbox") }.foregroundStyle(Theme.text2).transition(.scale(scale: 0.9).combined(with: .opacity)) }
            Spacer(minLength: 0)
        }
        .animation(.spring(response: 0.2, dampingFraction: 0.75), value: p.tokens.map { $0.text })
    }

    var suggestionList: some View {
        VStack(alignment: .leading, spacing: 0) {
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
            ForEach(Array(suggestions.enumerated()), id: \.element.id) { idx, p in
                HStack(spacing: 8) {
                    Avatar(person: p, size: 20); Text(p.name).font(.system(size: 13)); Text("@\(p.handle)").font(Theme.mono).foregroundStyle(Theme.text2)
                    Spacer(); if idx == suggestionIndex { Kbd("tab") }
                }.padding(.horizontal, 18).padding(.vertical, 6)
                .background(idx == suggestionIndex ? Color.gray.opacity(0.15) : .clear)
            }
            if suggestions.isEmpty, let q = atQuery, !q.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: "plus.circle").foregroundStyle(Theme.text2)
                    Text("Create \(q.capitalized)").font(.system(size: 13)); Spacer(); Kbd("⏎")
                }.padding(.horizontal, 18).padding(.vertical, 6)
            }
        }
    }

    func dueText(_ d: Date, time: Bool) -> String {
        let cal = Calendar.current
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: Date()), to: cal.startOfDay(for: d)).day ?? 0
        let day = days == 0 ? "Today" : days == 1 ? "Tomorrow" : Fmt.short(d, "EEE d MMM")
        return time ? "\(day) \(Fmt.short(d, "HH:mm"))" : day
    }

    func recurText(_ r: String) -> String {
        if r.contains("BYDAY=MO,TU,WE,TH,FR") { return "weekdays" }
        if let d = r.components(separatedBy: "BYDAY=").last, r.contains("BYDAY"), let n = ["MO": "Mon", "TU": "Tue", "WE": "Wed", "TH": "Thu", "FR": "Fri", "SA": "Sat", "SU": "Sun"][d] { return "every \(n)" }
        if r.contains("INTERVAL="), let n = r.components(separatedBy: "INTERVAL=").last { return "every \(n) \(r.contains("WEEKLY") ? "weeks" : r.contains("MONTHLY") ? "months" : "days")" }
        return r.contains("MONTHLY") ? "monthly" : r.contains("DAILY") ? "daily" : "weekly"
    }

    // MARK: actions

    func complete() {
        guard let p = suggestions.indices.contains(suggestionIndex) ? suggestions[suggestionIndex] : suggestions.first,
              var parts = Optional(text.split(separator: " ", omittingEmptySubsequences: false).map(String.init)) else { return }
        parts.removeLast(); parts.append("@\(p.handle) ")
        text = parts.joined(separator: " "); cursorToEnd += 1; suggestionIndex = 0
    }

    func submit(stay: Bool) {
        let line = text
        guard !line.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        model.save(line, stay: stay)
        if stay { text = ""; cursorToEnd += 1; return }
        saving = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.16) { onClose() }
    }

    func dismiss() { onClose() }

    func highlighted(_ s: String) -> AttributedString {
        var a = AttributedString(s)
        a.foregroundColor = Theme.text
        let p = CaptureParser.parse(s)
        for t in p.tokens {
            guard let r = Range(t.range, in: s), let ar = Range(r, in: a) else { continue }
            a[ar].foregroundColor = CaptureHighlight.color(t.role, kind: p.kind)
            if t.role == .person { a[ar].underlineStyle = .single }
        }
        return a
    }
}

enum CaptureHighlight {
    static func color(_ role: ParsedToken.Role, kind: ItemKind) -> Color {
        switch role {
        case .kind: return Theme.kind(kind)
        case .person: return Theme.text
        case .date, .remind: return Theme.kind(.wait)
        case .recurrence: return Theme.kind(.bring)
        case .tag, .quote: return Theme.kind(.said)
        case .pin: return Theme.clay
        }
    }
}

// MARK: - Text field with syntax highlighting

struct CaptureField: NSViewRepresentable {
    @Binding var text: String
    var placeholder: String
    var parse: (String) -> ParsedCapture
    var onSubmit: (Bool) -> Void
    var onEscape: () -> Void
    var onUp: () -> Void
    var onDown: () -> Void
    var onTab: () -> Void
    var moveToEnd: Int

    func makeNSView(context: Context) -> NSTextField {
        let f = NSTextField()
        f.isBordered = false; f.drawsBackground = false; f.focusRingType = .none
        f.font = .systemFont(ofSize: 20)
        f.placeholderAttributedString = NSAttributedString(string: placeholder, attributes: [.foregroundColor: NSColor.tertiaryLabelColor, .font: NSFont.systemFont(ofSize: 20)])
        f.delegate = context.coordinator
        f.cell?.usesSingleLineMode = true
        f.cell?.isScrollable = true
        DispatchQueue.main.async { f.window?.makeFirstResponder(f) }
        NotificationCenter.default.addObserver(forName: .captureWillShow, object: nil, queue: .main) { [weak f] _ in
            DispatchQueue.main.async { f?.stringValue = ""; f?.window?.makeFirstResponder(f) }
        }
        return f
    }

    func updateNSView(_ f: NSTextField, context: Context) {
        context.coordinator.parent = self
        if f.stringValue != text {
            f.stringValue = text
            if let ed = f.currentEditor() as? NSTextView { ed.setSelectedRange(NSRange(location: (text as NSString).length, length: 0)); context.coordinator.highlight(ed) }
        }
        if context.coordinator.lastMove != moveToEnd {
            context.coordinator.lastMove = moveToEnd
            if let ed = f.currentEditor() as? NSTextView { ed.setSelectedRange(NSRange(location: (text as NSString).length, length: 0)); context.coordinator.highlight(ed) }
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, NSTextFieldDelegate {
        var parent: CaptureField
        var lastMove = 0
        init(_ p: CaptureField) { parent = p }

        func controlTextDidChange(_ n: Notification) {
            guard let f = n.object as? NSTextField, let ed = f.currentEditor() as? NSTextView else { return }
            parent.text = f.stringValue
            highlight(ed)
        }

        func highlight(_ ed: NSTextView) {
            guard let ts = ed.textStorage else { return }
            let s = ts.string
            let full = NSRange(location: 0, length: (s as NSString).length)
            let p = parent.parse(s)
            ts.beginEditing()
            ts.addAttributes([.foregroundColor: NSColor.labelColor, .font: NSFont.systemFont(ofSize: 20), .underlineStyle: 0], range: full)
            for t in p.tokens where NSMaxRange(t.range) <= full.length {
                ts.addAttribute(.foregroundColor, value: NSColor(CaptureHighlight.color(t.role, kind: p.kind)), range: t.range)
                if t.role == .kind { ts.addAttribute(.font, value: NSFont.monospacedSystemFont(ofSize: 18, weight: .medium), range: t.range) }
                if t.role == .person { ts.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: t.range) }
            }
            ts.endEditing()
            ed.typingAttributes = [.foregroundColor: NSColor.labelColor, .font: NSFont.systemFont(ofSize: 20)]
        }

        func control(_ control: NSControl, textView: NSTextView, doCommandBy sel: Selector) -> Bool {
            switch sel {
            case #selector(NSResponder.insertNewline(_:)), #selector(NSResponder.insertLineBreak(_:)), #selector(NSResponder.insertNewlineIgnoringFieldEditor(_:)):
                parent.onSubmit(NSEvent.modifierFlags.contains(.command)); return true
            case #selector(NSResponder.cancelOperation(_:)): parent.onEscape(); return true
            case #selector(NSResponder.moveUp(_:)): parent.onUp(); return true
            case #selector(NSResponder.moveDown(_:)): parent.onDown(); return true
            case #selector(NSResponder.insertTab(_:)): parent.onTab(); return true
            default: return false
            }
        }
    }
}
