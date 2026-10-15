import SwiftUI
import AppKit
import JaffloopCore

// MARK: - Due date editor (row click and details drawer)

struct DueEditor: View {
    var current: Date?
    var hasTime: Bool
    var apply: (Date?, Bool) -> Void
    @State private var date: Date
    @State private var withTime: Bool

    init(current: Date?, hasTime: Bool, apply: @escaping (Date?, Bool) -> Void) {
        self.current = current; self.hasTime = hasTime; self.apply = apply
        _date = State(initialValue: current ?? Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: Date()) ?? Date())
        _withTime = State(initialValue: hasTime)
    }

    private func day(_ off: Int) -> Date {
        let cal = Calendar.current
        return cal.date(byAdding: .day, value: off, to: cal.startOfDay(for: Date())) ?? Date()
    }

    var body: some View {
        let cal = Calendar.current
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                preset("Today") { apply(day(0), false) }
                preset("Tomorrow") { apply(day(1), false) }
                preset("Next Mon") { apply(cal.nextDate(after: Date(), matching: DateComponents(hour: 0, weekday: 2), matchingPolicy: .nextTime) ?? day(7), false) }
                preset("+1 week") { apply(day(7), false) }
            }
            DatePicker("", selection: $date, displayedComponents: withTime ? [.date, .hourAndMinute] : [.date])
                .datePickerStyle(.graphical).labelsHidden()
            Toggle("Include a time", isOn: $withTime).toggleStyle(.checkbox).font(.system(size: 12))
            HStack {
                if current != nil { QuietButton(title: "Clear") { apply(nil, false) } }
                Spacer()
                PrimaryButton(title: "Set") { apply(withTime ? date : cal.startOfDay(for: date), withTime) }
            }
        }
        .padding(14).frame(width: 270)
    }

    func preset(_ t: String, _ run: @escaping () -> Void) -> some View { GhostButton(title: t, action: run) }
}

// MARK: - Notes about a person

struct NotesField: View {
    @EnvironmentObject var model: AppModel
    let person: Person
    @State private var text: String
    @FocusState private var focused: Bool

    init(person: Person) { self.person = person; _text = State(initialValue: person.notes) }

    var body: some View {
        let first = person.name.split(separator: " ").first.map(String.init) ?? person.name
        ZStack(alignment: .topLeading) {
            TextEditor(text: $text).font(.system(size: 12.5)).scrollContentBackground(.hidden).focused($focused)
                .frame(minHeight: 52, maxHeight: 110)
                .padding(6)
                .background(RoundedRectangle(cornerRadius: 8).fill(Theme.elevated))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(focused ? Theme.accent : Theme.hairline, lineWidth: focused ? 1.2 : 0.5))
            if text.isEmpty {
                Text("Private notes about \(first): preferences, goals, what matters to them").font(.system(size: 12.5)).foregroundStyle(Theme.text2)
                    .padding(.horizontal, 12).padding(.vertical, 14).allowsHitTesting(false)
            }
        }
        .onChange(of: focused) { _, now in if !now { save() } }
        .onDisappear { save() }
        .accessibilityLabel("Notes about \(first)")
    }

    private func save() {
        guard text != person.notes, var p = model.person(person.id) else { return }
        p.notes = text
        model.savePerson(p)
    }
}
