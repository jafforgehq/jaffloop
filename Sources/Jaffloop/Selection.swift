import SwiftUI
import AppKit
import JaffloopCore

// MARK: - Keyboard navigation for lists of items

/// j/k or arrows move the selection; ⏎ completes, s snoozes to tomorrow, e edits the title,
/// space opens the details drawer, x marks for bulk actions, p pins, ⌫ drops, esc clears.
struct ItemKeys: ViewModifier {
    @EnvironmentObject var model: AppModel
    let items: [Item]
    /// Extra single-letter keys for a screen (Inbox triage). Return true when the key was used.
    var triage: ((String, Item) -> Bool)?
    @FocusState private var focused: Bool

    func body(content: Content) -> some View {
        content
            .focusable().focused($focused).focusEffectDisabled()
            .onAppear { focused = true }
            .onKeyPress(phases: .down) { handle($0) }
            .onChange(of: items.map { $0.id }) { _, ids in
                if let s = model.selectedItemId, !ids.contains(s) { model.selectedItemId = nil }
            }
    }

    private func neighbour(of id: String, _ ids: [String]) -> String? {
        guard let i = ids.firstIndex(of: id) else { return nil }
        if i + 1 < ids.count { return ids[i + 1] }
        return i > 0 ? ids[i - 1] : nil
    }

    private func handle(_ p: KeyPress) -> KeyPress.Result {
        guard !p.modifiers.contains(.command), !p.modifiers.contains(.control), !p.modifiers.contains(.option) else { return .ignored }
        let ids = items.map { $0.id }
        let sel = model.selectedItemId.flatMap { id in items.first { $0.id == id } }
        let bulk = Array(model.multi.filter { ids.contains($0) })

        func move(_ d: Int) {
            guard !ids.isEmpty else { return }
            if let cur = model.selectedItemId, let i = ids.firstIndex(of: cur) { model.selectedItemId = ids[max(0, min(ids.count - 1, i + d))] }
            else { model.selectedItemId = d > 0 ? ids.first : ids.last }
        }
        func tomorrow() -> Date? { model.snoozePresets().first { $0.label.hasPrefix("Tomorrow") }?.date }

        switch p.key {
        case .downArrow: move(1); return .handled
        case .upArrow: move(-1); return .handled
        case .return:
            if !bulk.isEmpty { model.completeMany(bulk); return .handled }
            guard let sel else { return .ignored }
            model.selectedItemId = neighbour(of: sel.id, ids); model.triggerComplete = sel.id; return .handled
        case .space:
            guard sel != nil else { return .ignored }
            withAnimation(Motion.spring()) { model.toggleDrawer() }; return .handled
        case .delete, .deleteForward:
            if !bulk.isEmpty { model.dropMany(bulk); return .handled }
            guard let sel else { return .ignored }
            model.selectedItemId = neighbour(of: sel.id, ids); model.drop(sel); return .handled
        case .escape:
            if !model.multi.isEmpty { model.multi = []; return .handled }
            if model.drawerItemId != nil { withAnimation(Motion.spring()) { model.drawerItemId = nil }; return .handled }
            if model.selectedItemId != nil { model.selectedItemId = nil; return .handled }
            return .ignored
        default: break
        }

        if p.characters == "?" { withAnimation(Motion.ease(0.2)) { model.showShortcuts.toggle() }; return .handled }
        if let triage, let sel, triage(p.characters, sel) { return .handled }

        switch p.characters {
        case "j": move(1)
        case "k": move(-1)
        case "s":
            guard let when = tomorrow() else { return .ignored }
            if !bulk.isEmpty { model.snoozeMany(bulk, until: when) }
            else if let sel { model.selectedItemId = neighbour(of: sel.id, ids); model.snooze(sel, until: when) }
            else { return .ignored }
        case "e":
            guard let sel else { return .ignored }
            model.triggerEdit = sel.id
        case "x":
            guard let sel else { return .ignored }
            model.toggleMulti(sel.id)
        case "p":
            guard let sel else { return .ignored }
            model.togglePin(sel)
        default: return .ignored
        }
        return .handled
    }
}

// MARK: - Undo toast and bulk bar

struct ToastBar: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        if let t = model.toast {
            HStack(spacing: 14) {
                Text(t.message).font(.system(size: 12.5)).foregroundStyle(Theme.text).lineLimit(1)
                if t.undo != nil {
                    Button { model.undoLast() } label: {
                        HStack(spacing: 6) { Text("Undo").font(.system(size: 12.5, weight: .semibold)); Kbd("⌘Z") }
                            .foregroundStyle(Theme.accent).modifier(FocusRing(radius: 5))
                    }.buttonStyle(.plain).keyboardShortcut("z", modifiers: .command)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 9)
            .background(Capsule().fill(Theme.elevated))
            .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 0.5))
            .shadow(color: .black.opacity(0.3), radius: 14, y: 6)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .accessibilityElement(children: .combine)
        }
    }
}

struct BulkBar: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        if !model.multi.isEmpty {
            let ids = Array(model.multi)
            HStack(spacing: 12) {
                Text("\(ids.count) selected").font(.system(size: 12.5, weight: .medium)).foregroundStyle(Theme.text)
                PrimaryButton(title: "Complete") { model.completeMany(ids) }
                Menu("Snooze") {
                    ForEach(model.snoozePresets()) { p in Button(p.label) { model.snoozeMany(ids, until: p.date) } }
                }.menuStyle(.borderlessButton).fixedSize().font(.system(size: 12.5))
                Menu("Assign") {
                    ForEach(model.orderedPeople) { s in Button(s.person.name) { model.assignMany(ids, handle: s.person.handle) } }
                }.menuStyle(.borderlessButton).fixedSize().font(.system(size: 12.5))
                Button("Drop") { model.dropMany(ids) }.buttonStyle(.plain).font(.system(size: 12.5)).foregroundStyle(Theme.clay)
                QuietButton(title: "Clear") { model.multi = [] }
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
            .background(Capsule().fill(Theme.elevated))
            .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 0.5))
            .shadow(color: .black.opacity(0.3), radius: 14, y: 6)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
}

// MARK: - Details drawer (every field is editable)

struct ItemDrawer: View {
    @EnvironmentObject var model: AppModel
    let item: Item
    @State private var title: String
    @State private var bodyText: String
    @State private var tagText = ""
    @State private var showDue = false
    @FocusState private var bodyFocus: Bool
    @FocusState private var titleFocus: Bool

    init(item: Item) {
        self.item = item
        _title = State(initialValue: item.title)
        _bodyText = State(initialValue: item.body ?? "")
    }

    var body: some View {
        let person = model.person(item.personId)
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Menu {
                        ForEach(ItemKind.allCases, id: \.self) { k in
                            Button(k.rawValue) { model.update(item, "Now \(k.rawValue)") { $0.kind = k } }
                        }
                    } label: { HStack(spacing: 4) { KindLabel(kind: item.kind); Image(systemName: "chevron.down").font(.system(size: 8)).foregroundStyle(Theme.text2) } }
                        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().accessibilityLabel("Kind: \(item.kind.rawValue). Change")
                    if item.status != .open { Text(item.status.rawValue).font(Theme.mono).foregroundStyle(Theme.text2) }
                    Spacer()
                    Button { withAnimation(Motion.spring()) { model.drawerItemId = nil } } label: {
                        Image(systemName: "xmark").font(.system(size: 10)).foregroundStyle(Theme.text2).frame(width: 22, height: 22)
                    }.buttonStyle(.plain).help("Close  esc").accessibilityLabel("Close details")
                }
                TextField("Title", text: $title, axis: .vertical).textFieldStyle(.plain).font(Theme.title(19)).foregroundStyle(Theme.text)
                    .focused($titleFocus).onSubmit { commitTitle() }
                    .onChange(of: titleFocus) { _, f in if !f { commitTitle() } }
                if let q = item.quote, !q.isEmpty {
                    Text("\u{201C}\(q)\u{201D}").font(.system(size: 13, design: .serif)).italic().foregroundStyle(Theme.text)
                }
                ZStack(alignment: .topLeading) {
                    TextEditor(text: $bodyText).font(.system(size: 12.5)).scrollContentBackground(.hidden).focused($bodyFocus)
                        .frame(minHeight: 64, maxHeight: 140).padding(5)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Theme.elevated))
                        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(bodyFocus ? Theme.accent : Theme.hairline, lineWidth: bodyFocus ? 1.2 : 0.5))
                    if bodyText.isEmpty { Text("Add details").font(.system(size: 12.5)).foregroundStyle(Theme.text2).padding(.horizontal, 11).padding(.vertical, 13).allowsHitTesting(false) }
                }
                .onChange(of: bodyFocus) { _, f in if !f { commitBody() } }
                Rectangle().fill(Theme.hairline).frame(height: 0.5)
                VStack(alignment: .leading, spacing: 9) {
                    field("Person") {
                        Menu {
                            Button("No one") { model.update(item, "Person removed") { $0.personId = nil } }
                            ForEach(model.orderedPeople) { s in Button(s.person.name) { model.update(item, "Assigned to \(s.person.name)") { $0.personId = s.person.id } } }
                        } label: {
                            HStack(spacing: 6) {
                                if let person { Avatar(person: person, size: 16); Text(person.name) } else { Text("No one").foregroundStyle(Theme.text2) }
                                Image(systemName: "chevron.down").font(.system(size: 8)).foregroundStyle(Theme.text2)
                            }
                        }.menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                    }
                    field("Due") {
                        Button { showDue = true } label: {
                            HStack(spacing: 6) {
                                Text(Fmt.exact(item) ?? "Set a date").foregroundStyle(Fmt.exact(item) == nil ? Theme.text2 : (Rules.isOverdue(item, now: Date()) ? Theme.clay : Theme.text))
                                Image(systemName: "calendar").font(.system(size: 10)).foregroundStyle(Theme.text2)
                            }.modifier(FocusRing(radius: 4))
                        }.buttonStyle(.plain)
                        .popover(isPresented: $showDue) {
                            DueEditor(current: item.dueAt, hasTime: item.dueHasTime) { d, t in
                                showDue = false
                                model.update(item, d == nil ? "Due date cleared" : "Due date changed") { $0.dueAt = d; $0.dueHasTime = t }
                            }
                        }
                    }
                    if let r = item.remindAt { field("Reminder") { Text(Fmt.short(r, "EEE d MMM HH:mm")) } }
                    if let rule = item.recurRule, !rule.isEmpty { field("Repeats") { Text(RecurrenceText.describe(rule)) } }
                    field("Created") { Text(Fmt.short(item.createdAt, "d MMM yyyy")) }
                    field("Last touched") { Text(Fmt.short(item.lastTouchedAt, "d MMM yyyy")) }
                    if item.snoozeCount > 0 { field("Snoozed") { Text("\(item.snoozeCount) time\(item.snoozeCount == 1 ? "" : "s")").foregroundStyle(Rules.isSlipping(item) ? Theme.clay : Theme.text) } }
                    field("Source") { Text(item.source.rawValue) }
                    field("Tags") {
                        TextField("tag, tag", text: $tagText).textFieldStyle(.plain).onSubmit { commitTags() }
                    }
                }
                if item.status == .open {
                    HStack(spacing: 8) {
                        PrimaryButton(title: "Complete") { model.complete(item) }
                        Menu("Snooze") {
                            ForEach(model.snoozePresets()) { p in Button(p.label) { model.snooze(item, until: p.date) } }
                        }.menuStyle(.borderlessButton).fixedSize().font(.system(size: 12.5))
                        QuietButton(title: item.pinned ? "Unpin" : "Pin") { model.togglePin(item) }
                        QuietButton(title: "Drop") { model.drop(item) }
                    }.padding(.top, 4)
                } else {
                    QuietButton(title: "Reopen") { model.reopen(item) }
                }
            }
            .padding(18)
        }
        .background(Theme.surface)
        .onAppear { tagText = model.tagsOf(item.id).joined(separator: ", ") }
        .onDisappear { commitTitle(); commitBody(); commitTags() }
    }

    private func commitTitle() {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { title = item.title } else if t != item.title { model.rename(item, t) }
    }
    private func commitBody() {
        let t = bodyText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard t != (item.body ?? "") else { return }
        model.update(item, "Details updated") { $0.body = t.isEmpty ? nil : t }
    }
    private func commitTags() { model.setTags(item, tagText.split(separator: ",").map(String.init)) }

    func field<V: View>(_ label: String, @ViewBuilder _ value: () -> V) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(label.uppercased()).font(.system(size: 10.5, weight: .medium)).tracking(0.7).foregroundStyle(Theme.text2).frame(width: 76, alignment: .leading)
            value().font(.system(size: 12.5)).foregroundStyle(Theme.text)
            Spacer(minLength: 0)
        }
    }
}
