import SwiftUI
import AppKit
import JaffloopCore

struct MainView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        ZStack {
            HStack(spacing: 0) {
                Sidebar().frame(width: 230)
                Rectangle().fill(Theme.hairline).frame(width: 0.5)
                Group {
                    switch model.nav {
                    case .today: TodayView()
                    case .ledger: LedgerView()
                    case .inbox: InboxView()
                    case .people: PeopleView()
                    case .releases: ReleasesView()
                    case .person(let id): PersonView(personId: id).id(id)
                    case .tag(let t): TagView(tag: t)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.bg)
                if let it = model.drawerItem {
                    Rectangle().fill(Theme.hairline).frame(width: 0.5)
                    ItemDrawer(item: it).frame(width: 300).transition(.move(edge: .trailing).combined(with: .opacity))
                }
            }
            if model.showSearch {
                Color.black.opacity(0.28).ignoresSafeArea().onTapGesture { model.showSearch = false }
                    .transition(.opacity)
                SearchPalette().transition(.scale(scale: 0.97).combined(with: .opacity))
            }
            VStack(spacing: 8) { Spacer(); ToastBar(); BulkBar() }.padding(.bottom, 20)
        }
        .animation(Motion.spring(), value: model.showSearch)
        .animation(Motion.spring(), value: model.drawerItemId)
        .animation(Motion.spring(), value: model.multi.isEmpty)
        .background(Theme.bg)
        .tint(Theme.accent)
        .frame(minWidth: 940, minHeight: 560)
    }
}

// MARK: - Sidebar

struct Sidebar: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Color.clear.frame(height: 34)
            Button { model.showSearch = true } label: {
                HStack {
                    Image(systemName: "magnifyingglass").font(.system(size: 11))
                    Text("Search").font(.system(size: 12.5))
                    Spacer()
                    Kbd("⌘K")
                }
                .foregroundStyle(Theme.text2).padding(.horizontal, 10).padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: 8).fill(Theme.hover))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.hairline, lineWidth: 0.5))
                .modifier(FocusRing(radius: 8))
            }.buttonStyle(.plain).padding(.horizontal, 12).padding(.bottom, 12)

            VStack(spacing: 1) {
                NavItem(icon: "circle.dotted", title: "Today", nav: .today, count: model.today.total, hot: model.overdueCount > 0, tip: "Items that need you today")
                NavItem(icon: "scroll", title: "Ledger", nav: .ledger, count: model.ledgerItems.count, tip: "Open promises you made")
                NavItem(icon: "tray", title: "Inbox", nav: .inbox, count: model.inboxItems.count, tip: "Captures to triage")
                NavItem(icon: "person.2", title: "People", nav: .people, count: nil)
            }.padding(.horizontal, 8)

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("PEOPLE").font(Theme.caps).tracking(0.8).foregroundStyle(Theme.text2)
                            .padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 4)
                        ForEach(model.orderedPeople) { s in PersonNavRow(summary: s).id(s.person.id) }
                        if !model.tags.isEmpty {
                            let hidden = model.collapsed.contains("sidebar.tags")
                            Button { withAnimation(Motion.ease(0.2)) { model.toggleCollapsed("sidebar.tags") } } label: {
                                HStack(spacing: 5) {
                                    Image(systemName: "chevron.right").font(.system(size: 8, weight: .bold)).rotationEffect(.degrees(hidden ? 0 : 90))
                                    Text("TAGS").font(Theme.caps).tracking(0.8)
                                    Spacer()
                                }.foregroundStyle(Theme.text2).contentShape(Rectangle()).modifier(FocusRing(radius: 4))
                            }
                            .buttonStyle(.plain).padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 4)
                            .accessibilityLabel("Tags, \(hidden ? "collapsed" : "expanded")")
                            if !hidden {
                                ForEach(model.tags, id: \.0) { t, c in
                                    NavRow(selected: model.nav == .tag(t), action: { model.nav = .tag(t) }) {
                                        Image(systemName: "number").font(.system(size: 10)).frame(width: 18)
                                        Text(t)
                                        Spacer()
                                        Text("\(c)").font(.system(size: 11.5).monospacedDigit())
                                    }
                                }
                            }
                        }
                    }.padding(.horizontal, 8)
                }
                .onAppear { if case .person(let id) = model.nav { proxy.scrollTo(id, anchor: .center) } }
            }
            Spacer(minLength: 0)
            VStack(alignment: .leading, spacing: 9) {
                HStack(spacing: 6) {
                    Image(systemName: "keyboard").font(.system(size: 10))
                    Text("Capture").font(.system(size: 11.5))
                    Kbd(hotkeyLabel(model.settings.hotkey))
                }
                UpdateBadge(updates: model.updates)
            }.foregroundStyle(Theme.text2).padding(.horizontal, 18).padding(.vertical, 12)
        }
        .background(model.snapshot ? AnyView(Theme.surface) : AnyView(VisualEffect(material: .sidebar)))
    }
}

/// "v0.0.3 · What's new", with a dot when there is something unseen or an update is available.
struct UpdateBadge: View {
    @EnvironmentObject var model: AppModel
    @ObservedObject var updates: UpdateChecker
    var body: some View {
        Button { model.nav = .releases } label: {
            HStack(spacing: 6) {
                Image(systemName: "sparkles").font(.system(size: 10))
                Text(updates.availableVersion.map { "Update \($0) available" } ?? (AppVersion(AppInfo.version) != nil ? "v\(AppInfo.version) · What's new" : "What's new")).font(.system(size: 11.5))
                if model.hasUnseenRelease || updates.availableVersion != nil { Circle().fill(Theme.accent).frame(width: 6, height: 6) }
            }.modifier(FocusRing(radius: 4))
        }.buttonStyle(.plain)
    }
}

struct PersonNavRow: View {
    @EnvironmentObject var model: AppModel
    let summary: PersonSummary
    @State private var targeted = false

    var body: some View {
        let p = summary.person
        NavRow(selected: model.nav == .person(p.id), action: { model.nav = .person(p.id) }) {
            Avatar(person: p, size: 18)
            Text(p.name).lineLimit(1)
            Spacer()
            if model.pinnedPeople.contains(p.id) { Image(systemName: "pin.fill").font(.system(size: 8)).foregroundStyle(Theme.text2).accessibilityLabel("Pinned") }
            if summary.cadenceOverdue { Circle().fill(Theme.clay).frame(width: 6, height: 6).help("Past 1:1 cadence").accessibilityLabel("Past 1:1 cadence").transition(.opacity) }
        }
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.accent, lineWidth: targeted ? 1.5 : 0))
        .animation(.easeOut(duration: 0.4), value: summary.cadenceOverdue)
        .dropDestination(for: String.self) { payloads, _ in
            let ids = payloads.flatMap { $0.split(separator: ",").map(String.init) }
            guard !ids.isEmpty else { return false }
            model.assignMany(ids, handle: p.handle)
            return true
        } isTargeted: { targeted = $0 }
        .contextMenu {
            Button(model.pinnedPeople.contains(p.id) ? "Unpin" : "Pin to top") { withAnimation(Motion.ease(0.25)) { model.togglePinned(person: p.id) } }
            Button("Prep brief") { model.openPersonBrief(p) }
        }
    }
}

struct NavRow<Content: View>: View {
    var selected: Bool
    var action: () -> Void
    @ViewBuilder var content: Content
    @EnvironmentObject var model: AppModel
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            HStack(spacing: 9) { content }
                .font(.system(size: 13)).foregroundStyle(selected ? Theme.text : Theme.text2)
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: 8).fill(selected ? Color.gray.opacity(0.22) : (hover ? Theme.hover : .clear)))
                .modifier(FocusRing(radius: 8))
                .contentShape(Rectangle())
        }.buttonStyle(.plain).onHover { hover = !model.snapshot && $0 }
          .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

struct NavItem: View {
    @EnvironmentObject var model: AppModel
    let icon: String, title: String, nav: Nav
    var count: Int?
    var hot = false
    var tip = ""
    var body: some View {
        NavRow(selected: model.nav == nav, action: { model.nav = nav }) {
            Image(systemName: icon).font(.system(size: 12)).frame(width: 18)
            Text(title)
            Spacer()
            if let count, count > 0 {
                Text("\(count)").font(.system(size: 11.5).monospacedDigit())
                    .foregroundStyle(hot ? .white : Theme.text2)
                    .padding(.horizontal, hot ? 7 : 0).padding(.vertical, hot ? 1 : 0)
                    .background(Capsule().fill(hot ? Theme.clay : .clear))
            }
        }
        .help(tip)
        .accessibilityLabel(count.map { $0 > 0 ? "\(title), \($0)" : title } ?? title)
    }
}

func hotkeyLabel(_ s: String) -> String {
    s.split(separator: "+").map { p -> String in
        switch p { case "opt": return "⌥"; case "cmd": return "⌘"; case "ctrl": return "⌃"; case "shift": return "⇧"; case "space": return "Space"; default: return p.uppercased() }
    }.joined()
}

// MARK: - Page chrome

struct Page<Content: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var header: () -> AnyView
    @ViewBuilder var content: Content
    @EnvironmentObject var model: AppModel

    init(_ title: String, subtitle: String? = nil, header: @escaping () -> AnyView = { AnyView(EmptyView()) }, @ViewBuilder content: () -> Content) {
        self.title = title; self.subtitle = subtitle; self.header = header; self.content = content()
    }

    var body: some View {
        let inner = VStack(alignment: .leading, spacing: 0) {
            Text(title).font(Theme.title()).foregroundStyle(Theme.text).lineLimit(1).truncationMode(.tail).padding(.top, 34)
                .accessibilityAddTraits(.isHeader)
            if let subtitle { Text(subtitle).font(.system(size: 13)).foregroundStyle(Theme.text2).padding(.top, 3) }
            header()
            content
        }
        .frame(maxWidth: 880, alignment: .leading)
        .padding(.horizontal, 34).padding(.bottom, 30)
        .frame(maxWidth: .infinity)   // centres the column when the window is wide
        if model.snapshot { inner.frame(maxHeight: .infinity, alignment: .top) } else {
            ScrollViewReader { proxy in
                ScrollView { inner }
                    .onChange(of: model.selectedItemId) { _, id in
                        if let id { withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo(id) } }
                    }
            }
        }
    }
}

struct ItemList: View {
    let items: [Item]
    var showPerson = true
    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { idx, i in
                ItemRow(item: i, index: idx, showPerson: showPerson)
                    .transition(.asymmetric(insertion: .opacity, removal: .opacity.combined(with: .move(edge: .trailing))))
            }
        }
    }
}

// MARK: - Today

struct TodayView: View {
    @EnvironmentObject var model: AppModel
    @AppStorage("todayGroup") private var group = "section"      // section | person | kind
    @AppStorage("todayFocus") private var focus = false

    struct Block: Identifiable { var id: String; var title: String; var tint: Color; var items: [Item] }

    private func blocks(_ t: TodaySections) -> [Block] {
        let all = t.slipping + t.overdue + t.today + t.waitingStale + t.inbox
        if focus {
            let top = t.slipping + t.overdue + t.today.filter { $0.pinned } + t.today.filter { !$0.pinned }
            return [Block(id: "focus", title: "Focus", tint: Theme.text2, items: Array(top.prefix(3)))]
        }
        switch group {
        case "person":
            let by = Dictionary(grouping: all) { $0.personId ?? "" }
            let keys = by.keys.sorted { a, b in
                if a.isEmpty != b.isEmpty { return b.isEmpty }
                return (model.person(a)?.name ?? "").localizedCaseInsensitiveCompare(model.person(b)?.name ?? "") == .orderedAscending
            }
            return keys.map { Block(id: "p." + $0, title: model.person($0)?.name ?? "No person", tint: Theme.text2, items: by[$0] ?? []) }
        case "kind":
            return ItemKind.allCases.compactMap { k in
                let it = all.filter { $0.kind == k }
                return it.isEmpty ? nil : Block(id: "k." + k.rawValue, title: k.rawValue, tint: Theme.kind(k), items: it)
            }
        default:
            return [Block(id: "slipping", title: "Slipping", tint: Theme.clay, items: t.slipping),
                    Block(id: "overdue", title: "Overdue", tint: Theme.clay, items: t.overdue),
                    Block(id: "today", title: "Today", tint: Theme.text2, items: t.today),
                    Block(id: "waiting", title: "Waiting on", tint: Theme.text2, items: t.waitingStale),
                    Block(id: "inbox", title: "Inbox", tint: Theme.text2, items: t.inbox)].filter { !$0.items.isEmpty }
        }
    }

    var body: some View {
        let t = model.today
        let checkIns = t.checkIn.filter { !model.dismissedCheckIns.contains($0.id) }
        let bs = blocks(t)
        let visible = bs.filter { !model.collapsed.contains("today." + $0.id) }.flatMap { $0.items }
        Page("Today", subtitle: Fmt.short(Date(), "EEEE, d MMMM"), header: { AnyView(VStack(alignment: .leading, spacing: 0) { KindMix(); controls }) }) {
            if t.total == 0 && checkIns.isEmpty {
                AllClosed()
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(bs) { b in
                        SectionBlock(key: "today." + b.id, title: b.title, count: b.items.count, tint: b.tint) { ItemList(items: b.items) }
                    }
                    if focus {
                        Button { withAnimation(Motion.ease()) { focus = false } } label: {
                            Text("Show all \(t.total)").font(.system(size: 12.5)).foregroundStyle(Theme.accent).padding(.vertical, 8).padding(.horizontal, 8)
                        }.buttonStyle(.plain).padding(.top, 8)
                    } else if !checkIns.isEmpty {
                        SectionHeader(title: "Check in", count: checkIns.count)
                        ForEach(checkIns) { s in CheckInRow(summary: s) }
                    }
                }
                .animation(Motion.ease(0.22), value: model.openItems.map { $0.id })
            }
        }
        .modifier(ItemKeys(items: visible))
    }

    var controls: some View {
        HStack(spacing: 10) {
            Picker("Group by", selection: $group) { Text("Sections").tag("section"); Text("People").tag("person"); Text("Kinds").tag("kind") }
                .pickerStyle(.segmented).frame(width: 240).labelsHidden().disabled(focus)
            Toggle(isOn: $focus.animation(Motion.ease())) { Label("Focus", systemImage: "scope").font(.system(size: 12)) }
                .toggleStyle(.button).help("Show only your top 3")
        }.padding(.top, 14)
    }
}

struct KindMix: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        let counts = ItemKind.allCases.map { k in (k, model.openItems.filter { $0.kind == k }.count) }.filter { $0.1 > 0 }
        let total = max(1, counts.map { $0.1 }.reduce(0, +))
        VStack(alignment: .leading, spacing: 8) {
            if !counts.isEmpty {
                Text("\(model.openItems.count) open · \(model.today.total) need you today").font(Theme.mono).foregroundStyle(Theme.text)
                GeometryReader { g in
                    HStack(spacing: 2) {
                        ForEach(counts, id: \.0) { k, c in
                            RoundedRectangle(cornerRadius: 1.5).fill(Theme.kind(k).opacity(0.85)).frame(width: max(4, (g.size.width - CGFloat(counts.count - 1) * 2) * CGFloat(c) / CGFloat(total)))
                        }
                    }
                }.frame(width: 260, height: 3)
                HStack(spacing: 14) {
                    ForEach(counts, id: \.0) { k, c in
                        HStack(spacing: 5) {
                            Circle().fill(Theme.kind(k)).frame(width: 6, height: 6)
                            Text("\(c) \(k.rawValue)").font(Theme.mono).foregroundStyle(Theme.text2)
                        }
                    }
                }.accessibilityElement(children: .combine)
            }
        }.padding(.top, 16)
    }
}

struct CheckInRow: View {
    @EnvironmentObject var model: AppModel
    let summary: PersonSummary
    var body: some View {
        HStack(spacing: 10) {
            Avatar(person: summary.person, size: 20)
            Text(summary.person.name).font(Theme.row)
            Text("\(summary.daysSinceLast ?? 0) days since your last 1:1").font(.system(size: 12.5)).foregroundStyle(Theme.clay)
            Spacer()
            QuietButton(title: "Schedule") { NSWorkspace.shared.open(URL(string: "ical://")!) }
            QuietButton(title: "Dismiss") { withAnimation(Motion.ease()) { model.dismissCheckIn(summary.id) } }
        }.padding(.vertical, 6).padding(.horizontal, 8)
    }
}

// MARK: - Ledger

struct LedgerView: View {
    @EnvironmentObject var model: AppModel
    @State private var overdueOnly = false

    var body: some View {
        let items = model.ledgerItems.filter { !overdueOnly || Rules.isOverdue($0, now: Date()) }
        let groups = Dictionary(grouping: items, by: { $0.personId ?? "" })
        let order = groups.keys.sorted { a, b in
            (groups[a]!.compactMap { $0.dueAt }.min() ?? .distantFuture) < (groups[b]!.compactMap { $0.dueAt }.min() ?? .distantFuture)
        }
        let flat = order.flatMap { groups[$0]!.sorted { ($0.dueAt ?? .distantFuture) < ($1.dueAt ?? .distantFuture) } }
        Page("Promise ledger", subtitle: "\(items.count) open · everything you have promised", header: {
            AnyView(Picker("", selection: $overdueOnly) { Text("All").tag(false); Text("Overdue").tag(true) }
                .pickerStyle(.segmented).frame(width: 160).labelsHidden().padding(.top, 14))
        }) {
            if items.isEmpty { AllClosed(title: "No open promises", message: "When you say you will do something, capture it: owe @sara review RFC fri.") }
            ForEach(order, id: \.self) { pid in
                let p = model.person(pid.isEmpty ? nil : pid)
                HStack(spacing: 8) {
                    if let p { Avatar(person: p, size: 20); Text(p.name).font(.system(size: 13, weight: .medium)) }
                    else { Text("No person").font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.text2) }
                    Text("\(groups[pid]!.count)").font(.system(size: 11.5).monospacedDigit()).foregroundStyle(Theme.text2)
                    Rectangle().fill(Theme.hairline).frame(height: 0.5)
                }.padding(.top, 20).padding(.bottom, 2)
                ItemList(items: groups[pid]!.sorted { ($0.dueAt ?? .distantFuture) < ($1.dueAt ?? .distantFuture) }, showPerson: false)
            }
        }
        .modifier(ItemKeys(items: flat))
    }
}

// MARK: - Inbox

struct InboxView: View {
    @EnvironmentObject var model: AppModel
    @State private var selected = 0
    @State private var pickPerson = false
    @FocusState private var focused: Bool

    var body: some View {
        let items = model.inboxItems
        Page("Inbox", subtitle: "Captures with no person and no date. Assign one or drop the item.") {
            if items.isEmpty { AllClosed(title: "Inbox zero", message: "Captures with no person and no date land here.") }
            VStack(spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.element.id) { idx, i in
                    VStack(alignment: .leading, spacing: 4) {
                        ItemRow(item: i, index: idx, showPerson: false)
                        if idx == min(selected, items.count - 1) {
                            HStack(spacing: 8) {
                                action("Person", "p") { pickPerson = true }
                                    .popover(isPresented: $pickPerson) { PersonPicker { h in pickPerson = false; model.assign(i, handle: h, due: nil) } }
                                action("Today", "d") { model.assign(i, handle: nil, due: Calendar.current.startOfDay(for: Date())) }
                                action("Tomorrow", "t") { model.assign(i, handle: nil, due: Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: Date()))) }
                                action("Next week", "w") { model.assign(i, handle: nil, due: nextMonday()) }
                                action("Drop", "x") { model.drop(i) }
                            }.padding(.leading, 34).padding(.bottom, 4)
                        }
                    }
                    .onTapGesture { selected = idx }
                }
            }
        }
        .focusable().focused($focused).focusEffectDisabled()
        .onAppear { focused = true }
        .onKeyPress(.downArrow) { selected = min(selected + 1, max(0, model.inboxItems.count - 1)); return .handled }
        .onKeyPress(.upArrow) { selected = max(selected - 1, 0); return .handled }
        .onKeyPress { press in
            let items = model.inboxItems
            guard !items.isEmpty else { return .ignored }
            let i = items[min(selected, items.count - 1)]
            switch press.characters {
            case "p": pickPerson = true
            case "d": model.assign(i, handle: nil, due: Calendar.current.startOfDay(for: Date()))
            case "t": model.assign(i, handle: nil, due: Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: Date())))
            case "w": model.assign(i, handle: nil, due: nextMonday())
            case "x": model.drop(i)
            default: return .ignored
            }
            return .handled
        }
    }

    func nextMonday() -> Date? {
        Calendar.current.nextDate(after: Date(), matching: DateComponents(hour: 0, weekday: 2), matchingPolicy: .nextTime)
    }

    func action(_ title: String, _ key: String, _ run: @escaping () -> Void) -> some View {
        Button(action: run) {
            HStack(spacing: 5) { Text(title).font(.system(size: 12)); Kbd(key) }
                .padding(.horizontal, 8).padding(.vertical, 3)
                .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(Theme.hairline, lineWidth: 0.5))
        }.buttonStyle(.plain)
    }
}

struct PersonPicker: View {
    @EnvironmentObject var model: AppModel
    var pick: (String) -> Void
    @State private var query = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField("Person…", text: $query).textFieldStyle(.roundedBorder).onSubmit {
                if let first = filtered.first { pick(first.person.handle) } else if !query.isEmpty { pick(query.lowercased().replacingOccurrences(of: " ", with: ".")) }
            }
            ForEach(filtered.prefix(6)) { s in
                Button { pick(s.person.handle) } label: { HStack { Avatar(person: s.person, size: 18); Text(s.person.name); Spacer() }.contentShape(Rectangle()) }.buttonStyle(.plain)
            }
            if filtered.isEmpty && !query.isEmpty {
                Button { pick(query.lowercased().replacingOccurrences(of: " ", with: ".")) } label: { Text("Create \u{201C}\(query)\u{201D}") }.buttonStyle(.plain)
            }
        }.padding(12).frame(width: 220)
    }
    var filtered: [PersonSummary] { query.isEmpty ? model.summaries : model.summaries.filter { $0.person.name.lowercased().contains(query.lowercased()) || $0.person.handle.contains(query.lowercased()) } }
}

// MARK: - Tag

struct TagView: View {
    @EnvironmentObject var model: AppModel
    let tag: String
    var body: some View {
        var f = ItemFilter(); f.tag = tag
        let items = (try? model.store.items(f)) ?? []
        return Page("#\(tag)", subtitle: "\(items.count) open") {
            if items.isEmpty { AllClosed(title: "Nothing tagged #\(tag)", message: "Add #\(tag) to a capture to see it here.") }
            ItemList(items: items).padding(.top, 14)
        }
        .modifier(ItemKeys(items: items))
    }
}

// MARK: - People

struct PeopleView: View {
    @EnvironmentObject var model: AppModel
    @State private var newName = ""

    var body: some View {
        Page("People", subtitle: "\(model.summaries.count) tracked") {
            HStack {
                TextField("Add a person…", text: $newName).textFieldStyle(.roundedBorder).frame(width: 240).onSubmit(add)
                GhostButton(title: "Add", action: add)
            }.padding(.top, 16)
            if model.summaries.isEmpty { AllClosed(title: "No one yet", message: "Add the people you meet with. Typing @name in a capture adds them too.") }
            VStack(spacing: 0) {
                ForEach(model.summaries) { s in
                    Button { model.nav = .person(s.person.id) } label: {
                        HStack(spacing: 12) {
                            CadenceRing(person: s.person, daysSince: s.daysSinceLast, overdue: s.cadenceOverdue, size: 40)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(s.person.name).font(.system(size: 13.5, weight: .medium)).foregroundStyle(Theme.text)
                                Text(s.person.relation.rawValue).font(Theme.mono).foregroundStyle(Theme.text2)
                            }
                            Spacer()
                            Text(s.daysSinceLast.map { "last 1:1 \($0)d ago" } ?? "no 1:1 logged")
                                .font(.system(size: 12)).foregroundStyle(s.cadenceOverdue ? Theme.clay : Theme.text2)
                            Text("\(s.openOwe) owe · \(s.openWait) wait").font(Theme.mono).foregroundStyle(Theme.text2).frame(width: 100, alignment: .trailing)
                        }.padding(.vertical, 8).padding(.horizontal, 8).contentShape(Rectangle())
                    }.buttonStyle(.plain)
                }
            }.padding(.top, 12)
        }
    }

    func add() {
        let n = newName.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty, let p = model.addPerson(name: n) else { return }
        newName = ""
        model.nav = .person(p.id)
    }
}

struct PersonView: View {
    @EnvironmentObject var model: AppModel
    let personId: String
    @State private var edit = false
    @State private var quick = ""

    var body: some View {
        if let s = model.summary(personId) {
            let p = s.person
            VStack(spacing: 0) {
                Page(p.name, subtitle: nil, header: { AnyView(header(s)) }) {
                    section("I owe them", .owe, empty: "Nothing promised.")
                    section("They owe me", .wait, empty: "Nothing pending.")
                    section("Bring up", .bring, empty: "No talking points.")
                    let said = model.saidLog(for: p.id)
                    if said.isEmpty { EmptySection(title: "Said log", message: "Nothing logged yet.") }
                    else {
                        SectionHeader(title: "Said log", count: said.count)
                        ForEach(said.prefix(12)) { SaidRow(item: $0) }
                    }
                }
                .modifier(ItemKeys(items: model.items(for: personId, kind: .owe) + model.items(for: personId, kind: .wait) + model.items(for: personId, kind: .bring)))
                quickAdd(p)
            }
        } else {
            Text("Person not found").foregroundStyle(Theme.text2).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    func header(_ s: PersonSummary) -> some View {
        let p = s.person
        return HStack(alignment: .center, spacing: 16) {
            CadenceRing(person: p, daysSince: s.daysSinceLast, overdue: s.cadenceOverdue, size: 60)
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 18) {
                    stat("Last 1:1", s.daysSinceLast.map { $0 == 0 ? "today" : "\($0) days ago" } ?? "never", hot: s.cadenceOverdue)
                    stat("Cadence", p.cadenceDays.map { "every \($0) days" } ?? "not set")
                    stat("Relation", p.relation.rawValue)
                }
                HStack(spacing: 8) {
                    PrimaryButton(title: "Log 1:1") { model.logInteraction(p) }
                    Menu {
                        Button("Prep brief") { model.openPersonBrief(p) }
                        Button("Edit person…") { edit = true }
                    } label: {
                        Image(systemName: "ellipsis").font(.system(size: 12)).foregroundStyle(Theme.text2).frame(width: 26, height: 24)
                            .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(Theme.hairline, lineWidth: 0.5))
                    }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                    .accessibilityLabel("Person options")
                    .popover(isPresented: $edit) { PersonEditor(person: p).environmentObject(model) }
                    if p.hiddenFromClaude { Chip { Image(systemName: "eye.slash").font(.system(size: 10)); Text("hidden from Claude") } }
                }
                CadenceStripView(person: p).padding(.top, 2)
            }
        }.padding(.top, 14)
    }

    func stat(_ k: String, _ v: String, hot: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(k.uppercased()).font(.system(size: 10.5, weight: .medium)).tracking(0.7).foregroundStyle(Theme.text2)
            Text(v).font(.system(size: 13).monospacedDigit()).foregroundStyle(hot ? Theme.clay : Theme.text)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder func section(_ title: String, _ kind: ItemKind, empty: String) -> some View {
        let items = model.items(for: personId, kind: kind)
        if items.isEmpty { EmptySection(title: title, message: empty) }
        else {
            SectionHeader(title: title, count: items.count)
            ItemList(items: items, showPerson: false)
        }
    }

    func quickAdd(_ p: Person) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "plus").font(.system(size: 11)).foregroundStyle(Theme.text2)
            TextField("Add for \(p.name.split(separator: " ").first.map(String.init) ?? p.name) — e.g. owe review RFC fri", text: $quick)
                .textFieldStyle(.plain).font(.system(size: 13)).onSubmit {
                    let t = quick.trimmingCharacters(in: .whitespaces)
                    guard !t.isEmpty else { return }
                    // Insert @person after an explicit prefix so "owe x" becomes "owe @sara x".
                    let first = t.split(separator: " ").first.map { String($0).lowercased() } ?? ""
                    let line = CaptureParser.prefixes[first] != nil && t.contains(" ")
                        ? first + " @\(p.handle) " + t.dropFirst(first.count).trimmingCharacters(in: .whitespaces)
                        : "@\(p.handle) " + t
                    model.save(line); quick = ""
                }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 9).fill(Theme.elevated))
        .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(Theme.hairline, lineWidth: 0.5))
        .padding(.horizontal, 20).padding(.vertical, 12)
        .background(Theme.surface).overlay(alignment: .top) { Rectangle().fill(Theme.hairline).frame(height: 0.5) }
    }
}

struct PersonEditor: View {
    @EnvironmentObject var model: AppModel
    @State var person: Person
    @State private var cadence = 0
    init(person: Person) { _person = State(initialValue: person); _cadence = State(initialValue: person.cadenceDays ?? 0) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("Name", text: $person.name).textFieldStyle(.roundedBorder)
            Picker("Relation", selection: $person.relation) { ForEach(Relation.allCases, id: \.self) { Text($0.rawValue).tag($0) } }
            Stepper(cadence == 0 ? "1:1 cadence: none" : "1:1 every \(cadence) days", value: $cadence, in: 0...90)
            TextField("Emails (comma separated)", text: $person.matchEmails).textFieldStyle(.roundedBorder)
            Toggle("Hide from Claude (MCP)", isOn: $person.hiddenFromClaude)
            Toggle("Archived", isOn: $person.archived)
            HStack { Spacer(); PrimaryButton(title: "Save") { var p = person; p.cadenceDays = cadence == 0 ? nil : cadence; model.savePerson(p) } }
        }.padding(14).frame(width: 300)
    }
}

/// Twelve dots, one per week, filled where a 1:1 happened.
struct CadenceStripView: View {
    @EnvironmentObject var model: AppModel
    let person: Person

    var body: some View {
        let weeks = CadenceStrip.weeks(model.interactionDates(person.id), now: Date())
        HStack(spacing: 5) {
            Text("12 WEEKS").font(.system(size: 10.5, weight: .medium)).tracking(0.7).foregroundStyle(Theme.text2).padding(.trailing, 4)
            ForEach(Array(weeks.enumerated()), id: \.offset) { _, met in
                Circle().fill(met ? Theme.accent : Color.clear)
                    .overlay(Circle().strokeBorder(met ? Theme.accent : Theme.text2.opacity(0.4), lineWidth: 1))
                    .frame(width: 8, height: 8)
                    .help(met ? "1:1 that week" : "No 1:1 that week")
            }
            Text("now").font(.system(size: 10.5)).foregroundStyle(Theme.text2).padding(.leading, 2)
        }
        .animation(.easeOut(duration: 0.4), value: weeks)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("1:1s in the last 12 weeks: \(weeks.filter { $0 }.count)")
    }
}

// MARK: - Search palette (⌘K)

struct SearchPalette: View {
    @EnvironmentObject var model: AppModel
    @State private var query = ""
    @State private var sel = 0
    @FocusState private var focus: Bool

    struct Row: Identifiable { var id: String; var icon: String; var title: String; var detail: String; var run: () -> Void }

    var rows: [Row] {
        var out: [Row] = []
        let q = query.trimmingCharacters(in: .whitespaces)
        func go(_ n: Nav) { model.showSearch = false; model.nav = n }
        let actions: [Row] = [
            Row(id: "a-today", icon: "circle.dotted", title: "Go to Today", detail: "action") { go(.today) },
            Row(id: "a-ledger", icon: "scroll", title: "Go to Promise ledger", detail: "action") { go(.ledger) },
            Row(id: "a-inbox", icon: "tray", title: "Go to Inbox", detail: "action") { go(.inbox) },
            Row(id: "a-people", icon: "person.2", title: "Go to People", detail: "action") { go(.people) },
            Row(id: "a-capture", icon: "plus", title: "New capture", detail: "action") { model.showSearch = false; model.openCapture() },
            Row(id: "a-settings", icon: "gearshape", title: "Open Settings", detail: "action") { model.showSearch = false; model.openSettings() },
        ]
        if q.isEmpty { return actions }
        out += actions.filter { $0.title.lowercased().contains(q.lowercased()) }
        out += model.summaries.filter { $0.person.name.lowercased().contains(q.lowercased()) || $0.person.handle.contains(q.lowercased().replacingOccurrences(of: "@", with: "")) }
            .map { s in Row(id: "p-\(s.id)", icon: "person", title: s.person.name, detail: s.person.relation.rawValue) { go(.person(s.person.id)) } }
        let items = (try? model.store.search(q, limit: 12)) ?? []
        out += items.map { i in
            Row(id: "i-\(i.id)", icon: "circle", title: i.title, detail: "\(i.kind.rawValue)\(i.status == .open ? "" : " · \(i.status.rawValue)")") {
                if let pid = i.personId { go(.person(pid)) } else { go(.today) }
            }
        }
        return out
    }

    var body: some View {
        let r = rows
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(Theme.text2)
                TextField("Search items, people, actions…  @person  kind:owe  before:2026-11-01", text: $query)
                    .textFieldStyle(.plain).font(.system(size: 15)).focused($focus)
                    .onSubmit { if r.indices.contains(sel) { r[sel].run() } }
                    .onChange(of: query) { _, _ in sel = 0 }
                Kbd("esc")
            }.padding(14)
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
            VStack(spacing: 0) {
                ForEach(Array(r.prefix(9).enumerated()), id: \.element.id) { idx, row in
                    HStack(spacing: 10) {
                        Image(systemName: row.icon).font(.system(size: 11)).foregroundStyle(Theme.text2).frame(width: 18)
                        Text(row.title).font(.system(size: 13)).lineLimit(1)
                        Spacer()
                        Text(row.detail).font(Theme.mono).foregroundStyle(Theme.text2)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(RoundedRectangle(cornerRadius: 7).fill(idx == sel ? Color.gray.opacity(0.18) : .clear))
                    .contentShape(Rectangle()).onTapGesture { row.run() }
                }
                if r.isEmpty { Text("No results").font(.system(size: 12.5)).foregroundStyle(Theme.text2).padding(18) }
            }.padding(6)
        }
        .frame(width: 560)
        .background(RoundedRectangle(cornerRadius: 16).fill(Theme.elevated))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.hairline, lineWidth: 0.5))
        .shadow(color: .black.opacity(0.35), radius: 30, y: 14)
        .frame(maxHeight: .infinity, alignment: .top).padding(.top, 90)
        .onAppear { focus = true; query = "" ; sel = 0 }
        .onKeyPress(.downArrow) { sel = min(sel + 1, max(0, min(r.count, 9) - 1)); return .handled }
        .onKeyPress(.upArrow) { sel = max(sel - 1, 0); return .handled }
        .onKeyPress(.escape) { model.showSearch = false; return .handled }
    }
}
