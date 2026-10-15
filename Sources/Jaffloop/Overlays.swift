import SwiftUI
import AppKit
import JaffloopCore

// MARK: - Keyboard cheat sheet (press ?)

struct ShortcutsView: View {
    @EnvironmentObject var model: AppModel
    @FocusState private var focused: Bool

    private var groups: [(String, [(String, String)])] {
        [
            ("In lists", [("j  k  ↑  ↓", "Move the selection"), ("⏎", "Complete"), ("s", "Snooze to tomorrow"), ("e", "Edit the title"),
                          ("space", "Open or close details"), ("x", "Mark for bulk actions"), ("p", "Pin or unpin"), ("⌫", "Drop"), ("esc", "Clear marks, close details")]),
            ("Inbox triage", [("p", "Assign a person"), ("d  t  w", "Due today, tomorrow, next week"), ("x", "Drop")]),
            ("Anywhere", [(hotkeyLabel(model.settings.hotkey), "Capture from any app"), ("⌘K", "Search"), ("⌘N", "New capture"), ("⌘1 – 4", "Today, Ledger, Inbox, People"),
                          ("⌘[  ⌘]", "Back and forward"), ("⌘\\", "Hide or show the sidebar"), ("⌘Z", "Undo while the toast shows"), ("?", "This sheet")]),
            ("Capture bar", [("⏎", "Save"), ("⌘⏎", "Save and keep open"), ("tab", "Complete an @person"), ("↑", "Repeat the last capture"), ("esc", "Cancel")]),
        ]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Keyboard shortcuts").font(Theme.title(20)).foregroundStyle(Theme.text)
                Spacer()
                Button { withAnimation(Motion.ease(0.2)) { model.showShortcuts = false } } label: {
                    Image(systemName: "xmark").font(.system(size: 10)).foregroundStyle(Theme.text2).frame(width: 24, height: 24)
                }.buttonStyle(.plain).accessibilityLabel("Close")
            }
            HStack(alignment: .top, spacing: 30) {
                VStack(alignment: .leading, spacing: 18) { block(groups[0]); block(groups[1]) }
                VStack(alignment: .leading, spacing: 18) { block(groups[2]); block(groups[3]) }
            }
        }
        .padding(24).frame(width: 640)
        .background(RoundedRectangle(cornerRadius: 16).fill(Theme.elevated))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.hairline, lineWidth: 0.5))
        .shadow(color: .black.opacity(0.35), radius: 30, y: 14)
        .focusable().focused($focused).focusEffectDisabled()
        .onAppear { focused = true }
        .onKeyPress(.escape) { withAnimation(Motion.ease(0.2)) { model.showShortcuts = false }; return .handled }
        .onKeyPress { p in if p.characters == "?" { withAnimation(Motion.ease(0.2)) { model.showShortcuts = false }; return .handled }; return .ignored }
        .accessibilityElement(children: .contain).accessibilityLabel("Keyboard shortcuts")
    }

    func block(_ g: (String, [(String, String)])) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(g.0.uppercased()).font(Theme.caps).tracking(0.8).foregroundStyle(Theme.text2)
            ForEach(g.1, id: \.0) { k, d in
                HStack(spacing: 10) {
                    Text(k).font(.system(size: 12, design: .monospaced)).foregroundStyle(Theme.text).frame(width: 78, alignment: .leading)
                    Text(d).font(.system(size: 12.5)).foregroundStyle(Theme.text2)
                }
            }
        }
    }
}

// MARK: - First run

struct WelcomeView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                LoopRing(size: 26, lineWidth: 2.2)
                Text("Welcome to Jaffloop").font(Theme.title(22)).foregroundStyle(Theme.text)
            }
            Text("Track what you owe people, what they owe you, what to bring up, and what you told them. Everything stays on this Mac.")
                .font(.system(size: 13)).foregroundStyle(Theme.text2).fixedSize(horizontal: false, vertical: true)
            step("1", "Capture from anywhere", "Press \(hotkeyLabel(model.settings.hotkey)), type owe @sara review RFC fri, press ⏎. Change the shortcut in Settings.")
            step("2", "Work the list with the keyboard", "j and k to move, ⏎ to complete, s to snooze, space for details. Press ? any time for the full list.")
            step("3", "Let Claude help", "Settings → Claude (MCP) has the one command that connects Claude to your data. Nothing is shared until you do.")
            step("4", "See what changes", "What's new and the roadmap are at the bottom of the sidebar.")
            HStack(spacing: 10) {
                Spacer()
                GhostButton(title: "Add an example item") { model.dismissWelcome(addExample: true) }
                PrimaryButton(title: "Start") { model.dismissWelcome() }
            }
        }
        .padding(26).frame(width: 520)
        .background(RoundedRectangle(cornerRadius: 18).fill(Theme.elevated))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Theme.hairline, lineWidth: 0.5))
        .shadow(color: .black.opacity(0.4), radius: 34, y: 16)
        .accessibilityElement(children: .contain).accessibilityLabel("Welcome to Jaffloop")
    }

    func step(_ n: String, _ title: String, _ body: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(n).font(.system(size: 12, weight: .semibold, design: .monospaced)).foregroundStyle(Theme.text)
                .frame(width: 22, height: 22).background(Circle().fill(Theme.hover)).overlay(Circle().strokeBorder(Theme.hairline, lineWidth: 0.5))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.text)
                Text(body).font(.system(size: 12.5)).foregroundStyle(Theme.text2).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

// MARK: - 1:1 mode

/// A calm page for the meeting itself: what to bring up, what is owed both ways, a place to record what was said.
struct OneOnOneView: View {
    @EnvironmentObject var model: AppModel
    let person: Person
    var onEnd: () -> Void
    @State private var started = Date()
    @State private var said = ""
    @State private var quick = ""

    var body: some View {
        let first = person.name.split(separator: " ").first.map(String.init) ?? person.name
        let bring = model.items(for: person.id, kind: .bring)
        let owe = model.items(for: person.id, kind: .owe)
        let wait = model.items(for: person.id, kind: .wait)
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                Avatar(person: person, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text("1:1 with \(person.name)").font(Theme.title(20)).foregroundStyle(Theme.text)
                    TimelineView(.periodic(from: started, by: 1)) { ctx in
                        let s = max(0, Int(ctx.date.timeIntervalSince(started)))
                        Text(String(format: "%d:%02d", s / 60, s % 60)).font(Theme.date).foregroundStyle(Theme.text2)
                    }
                }
                Spacer()
                GhostButton(title: "Cancel") { onEnd() }
                PrimaryButton(title: "End 1:1 and log it") { model.logInteraction(person); onEnd() }
            }.padding(.horizontal, 28).padding(.top, 34).padding(.bottom, 14)
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
            HStack(alignment: .top, spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        group("Bring up", bring, empty: "Nothing to bring up.")
                        group("I owe \(first)", owe, empty: "You owe nothing.")
                        group("\(first) owes me", wait, empty: "Nothing pending.")
                    }.padding(.horizontal, 24).padding(.bottom, 24)
                }
                Rectangle().fill(Theme.hairline).frame(width: 0.5)
                VStack(alignment: .leading, spacing: 14) {
                    Text("WHAT YOU SAID").font(Theme.caps).tracking(0.8).foregroundStyle(Theme.text2)
                    TextField("A promise or a quote, saved word for word", text: $said).textFieldStyle(.roundedBorder)
                        .onSubmit {
                            let t = said.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "\"", with: "'")
                            guard !t.isEmpty else { return }
                            model.save("said @\(person.handle) \"\(t)\""); said = ""
                        }
                    ForEach(model.saidLog(for: person.id).prefix(3)) { SaidRow(item: $0) }
                    Text("CAPTURE").font(Theme.caps).tracking(0.8).foregroundStyle(Theme.text2).padding(.top, 6)
                    TextField("owe, wait or bring…", text: $quick).textFieldStyle(.roundedBorder)
                        .onSubmit { model.captureFor(person, quick); quick = "" }
                    Text("NOTES").font(Theme.caps).tracking(0.8).foregroundStyle(Theme.text2).padding(.top, 6)
                    NotesField(person: person).id(person.id)
                    Spacer(minLength: 0)
                }.padding(20).frame(width: 300)
            }
        }
        .modifier(ItemKeys(items: bring + owe + wait))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Theme.bg)
    }

    @ViewBuilder func group(_ title: String, _ items: [Item], empty: String) -> some View {
        if items.isEmpty { EmptySection(title: title, message: empty) }
        else { SectionHeader(title: title, count: items.count); ItemList(items: items, showPerson: false, showKind: false) }
    }
}
