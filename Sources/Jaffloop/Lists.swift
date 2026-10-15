import SwiftUI
import AppKit
import JaffloopCore

// MARK: - Done (finished and dropped)

struct DoneView: View {
    @EnvironmentObject var model: AppModel
    @State private var range = 7          // days, 0 = everything

    var body: some View {
        let since = range == 0 ? nil : Calendar.current.date(byAdding: .day, value: -range, to: Date())
        let items = (try? model.store.history(since: since)) ?? []
        Page("Done", subtitle: "\(items.count) finished or dropped", header: {
            AnyView(Picker("Range", selection: $range) { Text("7 days").tag(7); Text("30 days").tag(30); Text("All").tag(0) }
                .pickerStyle(.segmented).frame(width: 240).labelsHidden().padding(.top, 14))
        }) {
            if items.isEmpty {
                AllClosed(title: "Nothing here yet", message: "Items you complete or drop show up here, so you can find them again and reopen them.", showCapture: false)
            }
            VStack(spacing: 0) { ForEach(items) { HistoryRow(item: $0) } }.padding(.top, 8)
        }
    }
}

struct HistoryRow: View {
    @EnvironmentObject var model: AppModel
    let item: Item
    @State private var hovering = false

    var body: some View {
        let done = item.status == .done
        HStack(spacing: 10) {
            Image(systemName: done ? "checkmark.circle" : "xmark.circle").font(.system(size: 15)).foregroundStyle(Theme.text2).frame(width: 16)
                .accessibilityLabel(done ? "Done" : "Dropped")
            Text(item.title).font(Theme.row).foregroundStyle(Theme.text2).strikethrough(done, color: Theme.text2.opacity(0.6)).lineLimit(1).help(item.title)
            Spacer(minLength: 8)
            if hovering { QuietButton(title: "Reopen") { model.reopen(item) } }
            KindLabel(kind: item.kind).frame(width: Col.kind, alignment: .leading)
            HStack(spacing: 5) {
                if let p = model.person(item.personId) {
                    Avatar(person: p, size: 16)
                    Text(p.name.split(separator: " ").first.map(String.init) ?? p.name).font(.system(size: 11.5)).foregroundStyle(Theme.text2).lineLimit(1)
                }
            }.frame(width: Col.person, alignment: .leading)
            Text("\(done ? "Done" : "Dropped") \(Fmt.short(item.updatedAt, "d MMM"))").font(Theme.date).foregroundStyle(Theme.text2)
                .lineLimit(1).frame(width: Col.date, alignment: .trailing)
        }
        .padding(.vertical, 7).padding(.horizontal, 8)
        .background(RoundedRectangle(cornerRadius: 8).fill(hovering ? Theme.hover : .clear))
        .contentShape(Rectangle())
        .onHover { hovering = !model.snapshot && $0 }
        .contextMenu { Button("Reopen") { model.reopen(item) } }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Snoozed

struct SnoozedView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        let items = (try? model.store.snoozed()) ?? []
        Page("Snoozed", subtitle: "\(items.count) hidden until later") {
            if items.isEmpty {
                AllClosed(title: "Nothing snoozed", message: "Snooze an item with s, or from its menu, and it waits here until the time you chose.", showCapture: false)
            }
            VStack(spacing: 0) { ForEach(items) { SnoozedRow(item: $0) } }.padding(.top, 8)
        }
    }
}

struct SnoozedRow: View {
    @EnvironmentObject var model: AppModel
    let item: Item
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "moon.zzz").font(.system(size: 13)).foregroundStyle(Theme.text2).frame(width: 16).accessibilityHidden(true)
            Text(item.title).font(Theme.row).foregroundStyle(Theme.text).lineLimit(1).help(item.title)
            Spacer(minLength: 8)
            if hovering { QuietButton(title: "Wake now") { model.wake(item) } }
            KindLabel(kind: item.kind).frame(width: Col.kind, alignment: .leading)
            HStack(spacing: 5) {
                if let p = model.person(item.personId) {
                    Avatar(person: p, size: 16)
                    Text(p.name.split(separator: " ").first.map(String.init) ?? p.name).font(.system(size: 11.5)).foregroundStyle(Theme.text2).lineLimit(1)
                }
            }.frame(width: Col.person, alignment: .leading)
            Text(item.snoozedUntil.map { "back \(Fmt.short($0, "EEE HH:mm"))" } ?? "").font(Theme.date).foregroundStyle(Theme.text2)
                .lineLimit(1).frame(width: Col.date + 10, alignment: .trailing)
        }
        .padding(.vertical, 7).padding(.horizontal, 8)
        .background(RoundedRectangle(cornerRadius: 8).fill(hovering ? Theme.hover : .clear))
        .contentShape(Rectangle())
        .onHover { hovering = !model.snapshot && $0 }
        .contextMenu { Button("Wake now") { model.wake(item) } }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Saved filter

struct FilterView: View {
    @EnvironmentObject var model: AppModel
    let query: String

    var body: some View {
        let items = model.filterItems(query)
        Page("Filter", subtitle: query, header: {
            AnyView(HStack(spacing: 8) {
                Text("\(items.count) match\(items.count == 1 ? "" : "es")").font(.system(size: 12.5)).foregroundStyle(Theme.text2)
                QuietButton(title: "Remove filter") { model.removeFilter(query) }
            }.padding(.top, 12))
        }) {
            if items.isEmpty { AllClosed(title: "No matches", message: "Nothing matches this search right now.", showCapture: false) }
            ItemList(items: items).padding(.top, 8)
        }
        .modifier(ItemKeys(items: items))
    }
}
