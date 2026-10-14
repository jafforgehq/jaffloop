import SwiftUI
import AppKit
import JaffloopCore

// MARK: - Small pieces

struct KindLabel: View {
    let kind: ItemKind
    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(Theme.kind(kind)).frame(width: 6, height: 6)
            Text(kind.rawValue).font(Theme.mono).foregroundStyle(Theme.text2)
        }
        .accessibilityElement(children: .ignore).accessibilityLabel(kind.rawValue)
    }
}

struct Avatar: View {
    let person: Person
    var size: CGFloat = 22
    var body: some View {
        Text(person.initials)
            .font(.system(size: size * 0.4, weight: .semibold))
            .foregroundStyle(Theme.text)
            .frame(width: size, height: size)
            .background(Circle().fill(Theme.avatar))
            .overlay(Circle().strokeBorder(Theme.hairline, lineWidth: 0.5))
            .accessibilityHidden(true)
    }
}

struct SectionHeader: View {
    let title: String
    var count: Int?
    var tint: Color = Theme.text2
    var body: some View {
        HStack(spacing: 6) {
            Text(title.uppercased()).font(Theme.caps).tracking(0.8).foregroundStyle(tint)
            if let count { Text("\(count)").font(.system(size: 11.5).monospacedDigit()).foregroundStyle(Theme.text2) }
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
        }
        .padding(.top, 20).padding(.bottom, 4)
        .accessibilityElement(children: .combine).accessibilityAddTraits(.isHeader)
    }
}

/// An empty section collapsed to one dim line instead of a header plus a blank block.
struct EmptySection: View {
    let title: String
    let message: String
    var body: some View {
        HStack(spacing: 10) {
            Text(title.uppercased()).font(Theme.caps).tracking(0.8).foregroundStyle(Theme.text2)
            Text(message).font(.system(size: 12.5)).foregroundStyle(Theme.text2)
            Spacer(minLength: 0)
        }
        .padding(.top, 18).padding(.bottom, 2)
        .accessibilityElement(children: .combine)
    }
}

/// Visible keyboard-focus outline; reads the focus state of the nearest focusable ancestor (the Button).
struct FocusRing: ViewModifier {
    @Environment(\.isFocused) private var focused
    var radius: CGFloat = 7
    func body(content: Content) -> some View {
        content.overlay(RoundedRectangle(cornerRadius: radius).strokeBorder(Theme.text2, lineWidth: focused ? 1.5 : 0).padding(-2))
    }
}

struct Chip<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        HStack(spacing: 5) { content }
            .font(.system(size: 11.5)).foregroundStyle(Theme.text)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Capsule().fill(Theme.elevated))
            .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 0.5))
    }
}

struct Kbd: View {
    let text: String
    init(_ t: String) { text = t }
    var body: some View {
        Text(text).font(.system(size: 11, design: .monospaced)).foregroundStyle(Theme.text2)
            .padding(.horizontal, 5).padding(.vertical, 1)
            .background(RoundedRectangle(cornerRadius: 4).fill(Theme.hover))
            .accessibilityHidden(true)
    }
}

struct PrimaryButton: View {
    let title: String
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(.system(size: 12, weight: .medium))
                .padding(.horizontal, 12).padding(.vertical, 5)
                .foregroundStyle(Theme.bg).background(RoundedRectangle(cornerRadius: 7).fill(Theme.text))
                .modifier(FocusRing())
        }.buttonStyle(.plain)
    }
}

struct GhostButton: View {
    let title: String
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(.system(size: 12))
                .padding(.horizontal, 10).padding(.vertical, 4)
                .foregroundStyle(Theme.text)
                .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(Theme.hairline, lineWidth: 0.5))
                .modifier(FocusRing())
        }.buttonStyle(.plain)
    }
}

/// Low-emphasis text button: no outline until hovered.
struct QuietButton: View {
    let title: String
    var action: () -> Void
    @EnvironmentObject var model: AppModel
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            Text(title).font(.system(size: 12))
                .foregroundStyle(hover ? Theme.text : Theme.text2)
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(RoundedRectangle(cornerRadius: 6).fill(hover ? Theme.hover : .clear))
                .modifier(FocusRing(radius: 6))
        }.buttonStyle(.plain).onHover { hover = !model.snapshot && $0 }
    }
}

/// Only breathe while some window is actually visible.
struct WindowVisible: ViewModifier {
    @Binding var visible: Bool
    func body(content: Content) -> some View {
        content.onReceive(NotificationCenter.default.publisher(for: NSWindow.didChangeOcclusionStateNotification)) { _ in
            visible = NSApp.windows.contains { $0.isVisible && $0.occlusionState.contains(.visible) }
        }
    }
}

// MARK: - The loop

/// Signature motif: an open ring that closes when the item is finished.
struct LoopRing: View {
    var overdue = false
    var closed = false          // completion animation
    var hover = false           // previews a partial fill
    var size: CGFloat = 16
    var lineWidth: CGFloat = 1.5
    @State private var breathe = false
    @State private var visible = true

    var body: some View {
        let color = overdue ? Theme.clay : Theme.text2
        ZStack {
            Circle().stroke(color.opacity(overdue ? 0.9 : 0.5), lineWidth: lineWidth)
            Circle().trim(from: 0, to: closed ? 1 : (hover ? 0.28 : 0))
                .stroke(overdue ? Theme.clay : Theme.text, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.easeOut(duration: closed ? 0.35 : 0.18), value: closed)
                .animation(.easeOut(duration: 0.18), value: hover)
            Image(systemName: "checkmark").font(.system(size: size * 0.5, weight: .bold))
                .foregroundStyle(Theme.text).opacity(closed ? 1 : 0).scaleEffect(closed ? 1 : 0.4)
                .animation(.spring(response: 0.25, dampingFraction: 0.6).delay(closed ? 0.25 : 0), value: closed)
        }
        .frame(width: size, height: size)
        .opacity(overdue && breathe && visible && !Motion.reduced ? 0.5 : 1)
        .animation(overdue && visible && !Motion.reduced ? .easeInOut(duration: 1.3).repeatForever(autoreverses: true) : .default, value: breathe)
        .onAppear { if overdue { breathe = true } }
        .modifier(WindowVisible(visible: $visible))
        .accessibilityHidden(true)
    }
}

/// Avatar wrapped in a ring that fills as days since the last 1:1 approach the cadence.
struct CadenceRing: View {
    let person: Person
    var daysSince: Int?
    var overdue: Bool
    var size: CGFloat = 56
    @State private var shown = false

    var body: some View {
        let target: Double = {
            guard let c = person.cadenceDays, c > 0 else { return 0 }
            guard let d = daysSince else { return 1 }
            return min(1, Double(d) / Double(c))
        }()
        ZStack {
            Circle().stroke(Theme.hairline, lineWidth: 2.5)
            if person.cadenceDays != nil {
                Circle().trim(from: 0, to: shown ? target : 0)
                    .stroke(overdue ? Theme.clay : Theme.text2, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.easeOut(duration: Motion.reduced ? 0.1 : 0.8), value: shown)
            }
            Avatar(person: person, size: size - 12)
        }
        .frame(width: size, height: size)
        .onAppear { shown = true }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(person.cadenceDays == nil ? "No 1:1 cadence" : (overdue ? "Past 1:1 cadence" : "Within 1:1 cadence"))
    }
}

// MARK: - Snooze

struct SnoozeMenu: View {
    @EnvironmentObject var model: AppModel
    var onPick: (Date) -> Void
    @State private var custom = false
    @State private var customDate = Date().addingTimeInterval(3600 * 3)

    var body: some View {
        Menu {
            ForEach(model.snoozePresets()) { p in Button(p.label) { onPick(p.date) } }
            Divider()
            Button("Custom…") { custom = true }
        } label: {
            Image(systemName: "clock").font(.system(size: 12)).foregroundStyle(Theme.text2).frame(width: 22, height: 22)
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        .help("Snooze").accessibilityLabel("Snooze")
        .popover(isPresented: $custom) {
            VStack(spacing: 10) {
                DatePicker("", selection: $customDate).datePickerStyle(.graphical).labelsHidden()
                PrimaryButton(title: "Snooze") { custom = false; onPick(customDate) }
            }.padding(14).frame(width: 260)
        }
    }
}

// MARK: - Item row

struct ItemRow: View {
    @EnvironmentObject var model: AppModel
    let item: Item
    var index = 0
    var showPerson = true
    var showKind = true
    var compact = false

    @State private var hovering = false
    @State private var ringHover = false
    @State private var completing = false
    @State private var collapsed = false
    @State private var ghost: String?
    @State private var appeared = false

    private var dense: Bool { compact || model.settings.compact }
    private var overdue: Bool { Rules.isOverdue(item, now: Date()) }
    private var slipping: Bool { Rules.isSlipping(item) }

    var body: some View {
        content
            .padding(.vertical, dense ? 4 : 7)
            .frame(height: collapsed ? 0 : nil, alignment: .top)
            .clipped()
            .opacity(appeared || model.snapshot ? 1 : 0)
            .offset(y: appeared || model.snapshot || Motion.reduced ? 0 : 6)
            .onAppear {
                guard !appeared else { return }
                withAnimation(.easeOut(duration: 0.25).delay(Double(min(index, 14)) * 0.024)) { appeared = true }
            }
    }

    private var content: some View {
        HStack(spacing: 10) {
            Button(action: finish) {
                LoopRing(overdue: overdue || slipping, closed: completing, hover: ringHover, size: 16)
                    .modifier(FocusRing(radius: 9))
            }
            .buttonStyle(.plain)
            .onHover { ringHover = !model.snapshot && $0 }
            .help("Complete  ⏎")
            .accessibilityLabel("Complete \(item.title)")

            VStack(alignment: .leading, spacing: 1) {
                Text(item.title).font(Theme.row).foregroundStyle(Theme.text).lineLimit(1).truncationMode(.tail).help(item.title)
                if let b = item.body, !b.isEmpty, !dense {
                    Text(b).font(.system(size: 11.5)).foregroundStyle(Theme.text2).lineLimit(1)
                }
            }
            .opacity(ghost == nil ? 1 : 0)
            .overlay(alignment: .leading) {
                if let ghost { Text(ghost).font(Theme.row).italic().foregroundStyle(Theme.text2) }
            }

            Spacer(minLength: 8)

            if item.pinned { Image(systemName: "pin.fill").font(.system(size: 9)).foregroundStyle(Theme.text2) }
            if slipping {
                Text("slipping ×\(item.snoozeCount)").font(Theme.mono).foregroundStyle(.white)
                    .padding(.horizontal, 6).padding(.vertical, 2).background(Capsule().fill(Theme.clay))
            }
            if hovering && ghost == nil {
                SnoozeMenu { snooze(until: $0) }
                Menu {
                    Button(item.pinned ? "Unpin" : "Pin to top") { model.togglePin(item) }
                    Button("Drop", role: .destructive) { model.drop(item) }
                } label: { Image(systemName: "ellipsis").font(.system(size: 12)).foregroundStyle(Theme.text2).frame(width: 22, height: 22) }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().accessibilityLabel("More actions")
            }
            // Fixed-width cells, empty when there is nothing to show, so columns line up across rows.
            if showKind { KindLabel(kind: item.kind).frame(width: Col.kind, alignment: .leading) }
            if showPerson {
                HStack(spacing: 5) {
                    if let p = model.person(item.personId) {
                        Avatar(person: p, size: 16)
                        Text(p.name.split(separator: " ").first.map(String.init) ?? p.name).font(.system(size: 11.5)).foregroundStyle(Theme.text2).lineLimit(1)
                    }
                }.frame(width: Col.person, alignment: .leading)
            }
            let due = Fmt.due(item)
            Text(due ?? "").font(Theme.date).foregroundStyle(overdue ? Theme.clay : Theme.text2)
                .frame(width: Col.date, alignment: .trailing)
                .accessibilityLabel(due.map { overdue ? "Overdue, \($0)" : "Due \($0)" } ?? "No due date")
        }
        .offset(x: ghost != nil && !Motion.reduced ? 36 : 0)
        .padding(.horizontal, 8)
        .background(RoundedRectangle(cornerRadius: 8).fill(hovering ? Theme.hover : .clear))
        .contentShape(Rectangle())
        .onHover { hovering = !model.snapshot && $0 }
        .contextMenu {
            Button("Complete") { finish() }
            ForEach(model.snoozePresets()) { p in Button("Snooze: \(p.label)") { snooze(until: p.date) } }
            Divider()
            Button(item.pinned ? "Unpin" : "Pin to top") { model.togglePin(item) }
            Button("Drop", role: .destructive) { model.drop(item) }
        }
    }

    private func finish() {
        guard !completing else { return }
        withAnimation(.easeOut(duration: 0.35)) { completing = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.36) {
            withAnimation(Motion.ease(0.2)) { collapsed = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { model.complete(item) }
        }
    }

    private func snooze(until: Date) {
        withAnimation(Motion.ease(0.25)) { ghost = Fmt.backLabel(until) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.55) { model.snooze(item, until: until) }
    }
}

/// Said-log entries: a quote and when it was said.
struct SaidRow: View {
    let item: Item
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Circle().fill(Theme.kind(.said)).frame(width: 6, height: 6).padding(.leading, 5)
            Text("\u{201C}\(item.quote ?? item.title)\u{201D}").font(.system(size: 13, design: .serif)).italic().foregroundStyle(Theme.text)
            Spacer()
            Text(Fmt.short(item.createdAt, "MMM d")).font(Theme.date).foregroundStyle(Theme.text2)
        }
        .padding(.vertical, 6).padding(.horizontal, 8)
    }
}

// MARK: - Empty state

/// "All loops closed": ring completes with a brief burst of muted dots, at most once per day.
struct AllClosed: View {
    @State private var start: Date?
    private let burst: Bool = {
        let today = Fmt.short(Date(), "yyyy-MM-dd")
        if UserDefaults.standard.string(forKey: "burstDay") == today { return false }
        UserDefaults.standard.set(today, forKey: "burstDay")
        return !Motion.reduced
    }()
    @State private var closed = false

    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle().stroke(Theme.hairline, lineWidth: 3).frame(width: 64, height: 64)
                Circle().trim(from: 0, to: closed ? 1 : 0).stroke(Theme.text2, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    .rotationEffect(.degrees(-90)).frame(width: 64, height: 64)
                    .animation(.easeInOut(duration: burst ? 0.9 : 0.01), value: closed)
                if burst, let start {
                    TimelineView(.animation) { ctx in
                        Canvas { g, size in
                            let t = ctx.date.timeIntervalSince(start)
                            guard t > 0.7, t < 1.7 else { return }
                            let p = (t - 0.7)
                            let c = CGPoint(x: size.width / 2, y: size.height / 2)
                            for k in 0..<14 {
                                let a = Double(k) / 14 * .pi * 2
                                let r = 32 + 34 * p
                                let pt = CGPoint(x: c.x + cos(a) * r, y: c.y + sin(a) * r)
                                let col = [Theme.text2, Color(nsColor: NSColor(hex: 0xC9A46A)), Color(nsColor: NSColor(hex: 0x8DAE98)), Color(nsColor: NSColor(hex: 0x7E9DB5))][k % 4]
                                g.fill(Path(ellipseIn: CGRect(x: pt.x - 2, y: pt.y - 2, width: 4, height: 4)), with: .color(col.opacity(1 - p)))
                            }
                        }
                    }.frame(width: 200, height: 200).allowsHitTesting(false)
                }
            }.frame(width: 64, height: 64)
            Text("All loops closed").font(Theme.title(20)).foregroundStyle(Theme.text)
            Text("Nothing owed, nothing slipping.").font(.system(size: 12.5)).foregroundStyle(Theme.text2)
        }
        .frame(maxWidth: .infinity).padding(.top, 70)
        .onAppear { start = Date(); closed = true }
    }
}

// MARK: - Visual effect

struct VisualEffect: NSViewRepresentable {
    var material: NSVisualEffectView.Material
    var blending: NSVisualEffectView.BlendingMode = .behindWindow
    func makeNSView(context: Context) -> NSVisualEffectView {
        let v = NSVisualEffectView(); v.material = material; v.blendingMode = blending; v.state = .active; return v
    }
    func updateNSView(_ v: NSVisualEffectView, context: Context) { v.material = material; v.blendingMode = blending }
}
