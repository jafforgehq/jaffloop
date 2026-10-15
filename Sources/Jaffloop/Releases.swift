import SwiftUI
import AppKit
import JaffloopCore

// MARK: - Release notes and roadmap (shipped inside the app so an update explains itself)

struct ReleaseNote: Identifiable {
    var id: String { version }
    var version: String
    var date: String
    var title: String
    var highlights: [String]
}

struct RoadmapGroup: Identifiable {
    var id: String { title }
    var title: String
    var blurb: String
    var items: [String]
}

/// Keep in sync with docs/CHANGELOG.md and docs/ROADMAP.md.
enum Releases {
    static let notes: [ReleaseNote] = [
        ReleaseNote(version: "0.0.4", date: "2026-10-15", title: "Find it, fix it, keep it", highlights: [
            "Done view: everything you finished or dropped, with a Reopen button. Snoozed view: what is hidden and when it returns, with Wake now.",
            "The details drawer now edits everything: title, kind, person, due date, details and tags. Click any date in a list to change it.",
            "Inbox uses the same keys as every list (j k ⏎ s e space) plus p d t w x for triage. Press ? for a cheat sheet of every shortcut.",
            "Search shows who and what, highlights your words and jumps straight to the item. Save any search as a filter in the sidebar.",
            "Back and forward (⌘[ ⌘]) and a hideable sidebar (⌘\\\\).",
            "1:1 mode: a calm page for the meeting with your bring-up list, what is owed both ways, and a place to record what you said.",
            "Private notes on each person, shown on their page and in the brief. Copy a brief as text. People can be shown as a grid and sorted.",
            "Repeat icon on recurring items, age badges that turn amber then red, and an underline when a wait is stale. Drag pinned items to reorder them.",
            "Respects Reduce Transparency and Increase Contrast. Separate save, complete and undo sounds with a preview.",
            "First run: a short welcome that you can skip, with a button to add an example item.",
        ]),
        ReleaseNote(version: "0.0.3", date: "2026-10-15", title: "Faster to drive, calmer to read", highlights: [
            "Keyboard: j/k or arrows move, ⏎ completes, s snoozes to tomorrow, e edits the title, space opens details, x marks for bulk actions, p pins, ⌫ drops.",
            "Undo toast (⌘Z) after complete, drop, snooze, assign and rename.",
            "Details drawer, inline title editing, multi-select with a bulk bar, drag an item onto a person to reassign it.",
            "Today: collapsible sections, group by section, person or kind, and a Focus mode with your top 3.",
            "Age badge on owes and waits (\"12d\"), exact dates in tooltips, times follow your 12 or 24-hour setting.",
            "Person page: 12-week 1:1 strip, ring refill and pulse when you log a 1:1, Prep brief in the … menu.",
            "Sidebar: pinned people, people past their cadence first, collapsible tags, remembers where you were.",
            "Capture bar: live preview of the finished row, recent people first after @.",
            "Menu bar: overdue count next to the icon and a quick-add field in the popover.",
            "Settings: appearance (system, light, dark), accent colour, three row densities with a live preview.",
            "Check for updates (only when you press it, or if you turn on the daily check) and this What's new page.",
            "Removed calendar access, the pre-meeting card and the calendar permission prompt. Outlook already reminds you of meetings.",
        ]),
        ReleaseNote(version: "0.0.2", date: "2026-10-14", title: "UI polish, notarized", highlights: [
            "Rows line up in fixed kind, person and date columns.",
            "Larger small type and light-mode contrast fixes.",
            "Capture bar key hints, visible focus ring, VoiceOver labels.",
            "Record any capture hotkey in Settings.",
            "Save animation: a dot flies from the capture card to the menu bar icon.",
            "Notarized by Apple, so it opens on first launch.",
        ]),
        ReleaseNote(version: "0.0.1", date: "2026-10-14", title: "First release", highlights: [
            "One-line capture with a global hotkey, six item kinds, Today, Ledger, Inbox, People.",
            "Local MCP server so Claude can read and write your data.",
            "Morning brief, notifications with Done and Snooze, menu bar popover.",
        ]),
    ]

    static let roadmap: [RoadmapGroup] = [
        RoadmapGroup(title: "Next", blurb: "What I intend to build first, in rough order.", items: [
            "Monday and Friday reviews: Jaffloop supplies the facts over MCP, Claude writes the review, optional Jira, Confluence and Outlook context stays on Claude's side.",
            "Alias map per person (email, Jira handle) so reviews match people correctly.",
            "Capture nudges after meetings and at end of day: \"what did you promise?\" with one-tap people chips. No calendar access.",
            "Said-log check before a 1:1: what you told someone versus what you did.",
        ]),
        RoadmapGroup(title: "Later", blurb: "Wanted, not scheduled.", items: [
            "Growth and feedback thread per person for review and promotion evidence.",
            "Universal (Intel) build.",
            "Optional database encryption.",
            "Import and export as Markdown and CSV.",
            "Shortcuts actions and a jaffloop:// URL scheme.",
        ]),
        RoadmapGroup(title: "Open decisions", blurb: "Need an answer before work starts.", items: [
            "License: which parts are open (MCP server, data format) and which stay paid.",
            "Whether updates should ever download in the background. Today they never do.",
        ]),
    ]
}

// MARK: - Update check (only runs when asked)

final class UpdateChecker: ObservableObject {
    enum State: Equatable {
        case idle, checking, upToDate
        case available(version: String, page: URL, zip: URL?, notes: String)
        case failed(String)
    }

    @Published var state: State = .idle
    @Published var lastChecked: Date? = UserDefaults.standard.object(forKey: "lastUpdateCheck") as? Date

    var availableVersion: String? { if case .available(let v, _, _, _) = state { return v } else { return nil } }

    private struct GHRelease: Decodable {
        struct Asset: Decodable { let name: String; let browser_download_url: String }
        let tag_name: String
        let html_url: String
        let body: String?
        let assets: [Asset]
    }

    /// Daily background check, only if the user turned it on.
    func checkIfDue(enabled: Bool) {
        guard enabled else { return }
        if let last = lastChecked, Date().timeIntervalSince(last) < 86_400 { return }
        check()
    }

    func check() {
        if state == .checking { return }
        state = .checking
        Task {
            let result: State
            do {
                var req = URLRequest(url: URL(string: "https://api.github.com/repos/jafforgehq/jaffloop/releases/latest")!)
                req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
                req.setValue("Jaffloop/\(AppInfo.version)", forHTTPHeaderField: "User-Agent")
                req.timeoutInterval = 15
                let (data, resp) = try await URLSession.shared.data(for: req)
                guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
                let r = try JSONDecoder().decode(GHRelease.self, from: data)
                if let remote = AppVersion(r.tag_name), let local = AppVersion(AppInfo.version), remote <= local {
                    result = .upToDate
                } else if let page = URL(string: r.html_url) {
                    let zip = r.assets.first { $0.name.hasSuffix(".zip") }.flatMap { URL(string: $0.browser_download_url) }
                    result = .available(version: AppVersion(r.tag_name)?.description ?? r.tag_name, page: page, zip: zip, notes: r.body ?? "")
                } else { throw URLError(.badURL) }
            } catch {
                result = .failed("Could not reach GitHub. Check your connection and try again.")
            }
            await MainActor.run {
                self.state = result
                if case .failed = result { return }
                self.lastChecked = Date()
                UserDefaults.standard.set(self.lastChecked, forKey: "lastUpdateCheck")
            }
        }
    }
}

struct UpdatePanel: View {
    @ObservedObject var updates: UpdateChecker

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                PrimaryButton(title: updates.state == .checking ? "Checking…" : "Check for updates") { updates.check() }
                    .disabled(updates.state == .checking)
                status
            }
            if case .available(_, let page, let zip, let notes) = updates.state {
                if !notes.isEmpty {
                    Text(notes).font(.system(size: 12)).foregroundStyle(Theme.text2).lineLimit(8).fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 8) {
                    if let zip { GhostButton(title: "Download .zip") { NSWorkspace.shared.open(zip) } }
                    GhostButton(title: "Release page") { NSWorkspace.shared.open(page) }
                }
                Text("Unzip, quit Jaffloop, and replace it in Applications. Your data stays where it is.")
                    .font(.system(size: 11.5)).foregroundStyle(Theme.text2)
            }
        }
    }

    @ViewBuilder var status: some View {
        switch updates.state {
        case .idle:
            if let d = updates.lastChecked { Text("Last checked \(Fmt.short(d, "d MMM HH:mm"))").font(.system(size: 12)).foregroundStyle(Theme.text2) }
        case .checking: ProgressView().controlSize(.small)
        case .upToDate: Label("You're up to date", systemImage: "checkmark.circle").font(.system(size: 12)).foregroundStyle(Theme.text2)
        case .available(let v, _, _, _): Label("Version \(v) is available", systemImage: "arrow.down.circle").font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.accent)
        case .failed(let m): Text(m).font(.system(size: 12)).foregroundStyle(Theme.clay)
        }
    }
}

// MARK: - Page

struct ReleasesView: View {
    @EnvironmentObject var model: AppModel
    @State private var tab = "new"

    var body: some View {
        Page("What's new", subtitle: "Installed: version \(AppInfo.version)", header: { AnyView(header) }) {
            if tab == "new" {
                ForEach(Releases.notes) { ReleaseCard(note: $0, installed: $0.version == AppInfo.version, highlight: $0.version == AppInfo.version) }
            } else {
                Text("Plans change. Nothing here is a promise.").font(.system(size: 12.5)).foregroundStyle(Theme.text2).padding(.top, 14)
                ForEach(Releases.roadmap) { g in
                    SectionHeader(title: g.title)
                    Text(g.blurb).font(.system(size: 12)).foregroundStyle(Theme.text2).padding(.bottom, 4)
                    ForEach(g.items, id: \.self) { item in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Circle().fill(Theme.text2).frame(width: 4, height: 4).offset(y: -2)
                            Text(item).font(.system(size: 13)).foregroundStyle(Theme.text).fixedSize(horizontal: false, vertical: true)
                        }.padding(.vertical, 4).padding(.horizontal, 6)
                    }
                }
            }
        }
        .onAppear { model.markVersionSeen() }
    }

    @ViewBuilder var header: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let from = model.updatedFrom {
                HStack(spacing: 8) {
                    Image(systemName: "sparkles")
                    Text("Updated from \(from) to \(AppInfo.version). Here is what changed.").font(.system(size: 12.5, weight: .medium))
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(RoundedRectangle(cornerRadius: 9).fill(Theme.accent.opacity(0.14)))
                .padding(.top, 14)
            }
            Picker("", selection: $tab) { Text("What's new").tag("new"); Text("Roadmap").tag("road") }
                .pickerStyle(.segmented).frame(width: 220).labelsHidden().padding(.top, model.updatedFrom == nil ? 14 : 0)
            UpdatePanel(updates: model.updates)
        }
    }
}

struct ReleaseCard: View {
    let note: ReleaseNote
    var installed: Bool
    var highlight: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("Version \(note.version)").font(Theme.title(18)).foregroundStyle(Theme.text)
                if installed { Chip { Text("installed").font(.system(size: 11)) } }
                Spacer()
                Text(note.date).font(Theme.date).foregroundStyle(Theme.text2)
            }
            Text(note.title).font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.text2)
            ForEach(note.highlights, id: \.self) { h in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Circle().fill(highlight ? Theme.accent : Theme.text2).frame(width: 4, height: 4).offset(y: -2)
                    Text(h).font(.system(size: 12.5)).foregroundStyle(Theme.text).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(.top, 22).padding(.bottom, 4)
        .accessibilityElement(children: .combine)
    }
}
