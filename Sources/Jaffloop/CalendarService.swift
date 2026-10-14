import Foundation
import EventKit
import JaffloopCore

struct CalEvent: Identifiable, Equatable {
    var id: String
    var title: String
    var start: Date
    var end: Date
    var attendeeEmails: [String]
    var attendeeNames: [String]
    var attendeeCount: Int
}

/// Read-only EventKit access. Optional: everything else works without it.
final class CalendarService {
    private let eventStore = EKEventStore()
    private(set) var authorized = false

    func requestAccess(_ done: @escaping (Bool) -> Void) {
        eventStore.requestFullAccessToEvents { ok, _ in
            DispatchQueue.main.async { self.authorized = ok; done(ok) }
        }
    }

    var status: String {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .fullAccess: return "Allowed"
        case .denied, .restricted: return "Denied in System Settings"
        case .notDetermined: return "Not requested"
        default: return "Limited"
        }
    }

    func refreshAuthorization() { authorized = EKEventStore.authorizationStatus(for: .event) == .fullAccess }

    func events(from: Date, to: Date) -> [CalEvent] {
        guard authorized else { return [] }
        let pred = eventStore.predicateForEvents(withStart: from, end: to, calendars: nil)
        return eventStore.events(matching: pred).filter { !$0.isAllDay && $0.status != .canceled }.map { e in
            let att = (e.attendees ?? []).filter { !$0.isCurrentUser }
            let emails = att.compactMap { a -> String? in
                let s = a.url.absoluteString
                return s.lowercased().hasPrefix("mailto:") ? String(s.dropFirst(7)).lowercased() : nil
            }
            return CalEvent(id: e.eventIdentifier ?? UUID().uuidString, title: e.title ?? "Untitled", start: e.startDate, end: e.endDate,
                            attendeeEmails: emails, attendeeNames: att.compactMap { $0.name }, attendeeCount: att.count + 1)
        }.sorted { $0.start < $1.start }
    }

    /// Match by attendee email in `match_emails`, falling back to the person's name in the event title.
    static func match(_ e: CalEvent, people: [Person]) -> Person? {
        if let p = people.first(where: { p in !Set(p.emails).isDisjoint(with: e.attendeeEmails) }) { return p }
        let title = e.title.lowercased()
        return people.first { p in
            let first = p.name.split(separator: " ").first.map(String.init)?.lowercased() ?? p.handle
            return title.contains(p.name.lowercased()) || (first.count > 2 && title.range(of: "\\b\(NSRegularExpression.escapedPattern(for: first))\\b", options: .regularExpression) != nil)
        }
    }
}
