import SwiftUI
import AppKit
import Combine
import JaffloopCore

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var model: AppModel!
    let hotkey = HotkeyManager()
    let notifier = NotificationService()
    let calendar = CalendarService()
    var capturePanel: CapturePanel!
    var statusItem: NSStatusItem!
    let popover = NSPopover()
    var mainWindow: NSWindow?
    var settingsWindow: NSWindow?
    var briefWindow: NSWindow?
    var cardPanel: NSPanel?
    var cancellables = Set<AnyCancellable>()
    var shownEvents = Set<String>()
    var meetingTimer: Timer?

    func applicationDidFinishLaunching(_ n: Notification) {
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--screenshots"), i + 1 < args.count {
            Screenshots.run(into: URL(fileURLWithPath: args[i + 1]))
            return
        }
        var dbURL = JaffloopPaths.defaultURL
        if let i = args.firstIndex(of: "--db"), i + 1 < args.count { dbURL = URL(fileURLWithPath: args[i + 1]) }
        do {
            let pool = try openJaffloopDatabase(at: dbURL)
            model = AppModel(store: Store(pool))
        } catch {
            let a = NSAlert(); a.messageText = "Jaffloop could not open its database"; a.informativeText = "\(error)"; a.runModal(); NSApp.terminate(nil); return
        }
        NSApp.setActivationPolicy(.regular)
        buildMenu()
        wireModel()
        setupStatusItem()

        capturePanel = CapturePanel(model: model) { [weak self] in self?.capturePanel.orderOut(nil) }
        hotkey.onFire = { [weak self] in self?.toggleCapture() }
        hotkey.register(model.settings.hotkey)

        notifier.model = model; notifier.calendar = calendar
        notifier.start()
        notifier.reschedule()
        model.startWatching()

        calendar.refreshAuthorization()
        if model.settings.calendarEnabled, !calendar.authorized { calendar.requestAccess { _ in self.pollCalendar() } }
        meetingTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in self?.pollCalendar() }
        pollCalendar()

        if !args.contains("--background") { openMain() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { openMain() }
        return true
    }

    // MARK: wiring

    func wireModel() {
        model.openCapture = { [weak self] in self?.showCapture() }
        model.openSettings = { [weak self] in self?.openSettings() }
        model.openMain = { [weak self] in self?.openMain() }
        model.openMorningBrief = { [weak self] in self?.openMorningBrief() }
        model.openPersonBrief = { [weak self] p in self?.openPersonBrief(p) }
        model.onChange = { [weak self] in
            guard let self else { return }
            self.updateStatusIcon()
            self.notifier.reschedule()
        }
        model.$captureBlip.dropFirst().sink { [weak self] _ in self?.blip() }.store(in: &cancellables)
    }

    func toggleCapture() {
        if capturePanel.isVisible { capturePanel.orderOut(nil) } else { showCapture() }
    }

    func showCapture() { capturePanel.present() }

    // MARK: status item

    func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = LoopIcon.image(dot: false)
        statusItem.button?.target = self
        statusItem.button?.action = #selector(statusClicked)
        statusItem.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        statusItem.button?.wantsLayer = true
        popover.behavior = .transient
        popover.contentViewController = NSHostingController(rootView: PopoverView().environmentObject(model))
        updateStatusIcon()
    }

    func updateStatusIcon() { statusItem?.button?.image = LoopIcon.image(dot: model.overdueCount > 0) }

    @objc func statusClicked() {
        if NSApp.currentEvent?.type == .rightMouseUp {
            let m = NSMenu()
            m.addItem(withTitle: "Capture…", action: #selector(menuCapture), keyEquivalent: "").target = self
            m.addItem(withTitle: "Open Jaffloop", action: #selector(menuOpen), keyEquivalent: "").target = self
            m.addItem(withTitle: "Settings…", action: #selector(menuSettings), keyEquivalent: "").target = self
            m.addItem(.separator())
            m.addItem(withTitle: "Quit Jaffloop", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
            statusItem.menu = m
            statusItem.button?.performClick(nil)
            statusItem.menu = nil
        } else if popover.isShown {
            popover.performClose(nil)
        } else if let b = statusItem.button {
            popover.show(relativeTo: b.bounds, of: b, preferredEdge: .minY)
        }
    }

    func blip() {
        guard let layer = statusItem.button?.layer, !Motion.reduced else { return }
        layer.anchorPoint = CGPoint(x: 0.5, y: 0.5)
        let a = CAKeyframeAnimation(keyPath: "transform.scale")
        a.values = [1, 1.35, 1]; a.keyTimes = [0, 0.4, 1]; a.duration = 0.5
        layer.add(a, forKey: "blip")
    }

    @objc func menuCapture() { showCapture() }
    @objc func menuOpen() { openMain() }
    @objc func menuSettings() { openSettings() }

    // MARK: windows

    func host<V: View>(_ v: V, size: NSSize, title: String, style: NSWindow.StyleMask = [.titled, .closable, .miniaturizable]) -> NSWindow {
        let w = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: style, backing: .buffered, defer: false)
        w.title = title
        w.contentView = NSHostingView(rootView: v.environmentObject(model))
        w.isReleasedWhenClosed = false
        w.center()
        return w
    }

    func openMain() {
        if mainWindow == nil {
            let w = host(MainView(), size: NSSize(width: 1080, height: 700), title: "Jaffloop", style: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView])
            w.titlebarAppearsTransparent = true
            w.titleVisibility = .hidden
            w.setFrameAutosaveName("JaffloopMain")
            w.center()
            mainWindow = w
        }
        NSApp.activate(ignoringOtherApps: true)
        mainWindow?.makeKeyAndOrderFront(nil)
    }

    func openSettings() {
        if settingsWindow == nil {
            settingsWindow = host(SettingsView(calendar: calendar, onHotkeyChange: { [weak self] in
                guard let self else { return }
                self.hotkey.register(self.model.settings.hotkey)
            }), size: NSSize(width: 560, height: 460), title: "Jaffloop Settings")
        }
        NSApp.activate(ignoringOtherApps: true)
        settingsWindow?.makeKeyAndOrderFront(nil)
    }

    func openMorningBrief() {
        pollCalendar()
        briefWindow?.close()
        briefWindow = host(MorningBriefView(), size: NSSize(width: 620, height: 560), title: "Morning brief", style: [.titled, .closable, .resizable])
        NSApp.activate(ignoringOtherApps: true)
        briefWindow?.makeKeyAndOrderFront(nil)
    }

    func openPersonBrief(_ p: Person) {
        briefWindow?.close()
        briefWindow = host(PersonBriefView(person: p), size: NSSize(width: 620, height: 560), title: "Brief: \(p.name)", style: [.titled, .closable, .resizable])
        NSApp.activate(ignoringOtherApps: true)
        briefWindow?.makeKeyAndOrderFront(nil)
    }

    // MARK: calendar

    func pollCalendar() {
        guard model.settings.calendarEnabled else { model.meetings = []; return }
        calendar.refreshAuthorization()
        let cal = Calendar.current
        let start = cal.startOfDay(for: Date()), end = cal.date(byAdding: .day, value: 1, to: start)!
        model.meetings = calendar.events(from: start, to: end)
        let s = model.settings
        let people = model.summaries.map { $0.person }
        for e in model.meetings where e.start > Date() && e.start.timeIntervalSinceNow <= Double(s.preMeetingMinutes) * 60 && e.attendeeCount <= s.maxAttendees && !shownEvents.contains(e.id) {
            guard let p = CalendarService.match(e, people: people) else { continue }
            shownEvents.insert(e.id)
            let items = model.openItems.filter { $0.personId == p.id && [.owe, .wait, .bring].contains($0.kind) }
            notifier.postPreMeeting(person: p, event: e, items: items)
            showCard(person: p, event: e)
        }
    }

    func showCard(person: Person, event: CalEvent) {
        cardPanel?.orderOut(nil)
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 440, height: 340), styleMask: [.nonactivatingPanel, .borderless], backing: .buffered, defer: false)
        panel.isFloatingPanel = true; panel.level = .floating; panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        let v = PreMeetingCard(person: person, event: event, onOpen: { [weak self] in panel.orderOut(nil); self?.openPersonBrief(person) }, onDismiss: { panel.orderOut(nil) })
            .environmentObject(model)
        let h = NSHostingView(rootView: v); h.sizingOptions = []
        panel.contentView = h
        if let f = NSScreen.main?.visibleFrame { panel.setFrameOrigin(NSPoint(x: f.maxX - 440, y: f.minY)) }
        panel.orderFrontRegardless()
        cardPanel = panel
    }

    // MARK: menu

    func buildMenu() {
        let main = NSMenu()
        func add(_ menu: NSMenu, _ title: String, _ sel: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = [.command], target: AnyObject? = nil) {
            let i = menu.addItem(withTitle: title, action: sel, keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
            if let target { i.target = target }
        }
        let appItem = NSMenuItem(); main.addItem(appItem)
        let app = NSMenu(); appItem.submenu = app
        add(app, "About Jaffloop", #selector(NSApplication.orderFrontStandardAboutPanel(_:)))
        app.addItem(.separator())
        add(app, "Settings…", #selector(menuSettings), ",", target: self)
        app.addItem(.separator())
        add(app, "Hide Jaffloop", #selector(NSApplication.hide(_:)), "h")
        add(app, "Quit Jaffloop", #selector(NSApplication.terminate(_:)), "q")

        let fileItem = NSMenuItem(); main.addItem(fileItem)
        let file = NSMenu(title: "File"); fileItem.submenu = file
        add(file, "New Capture", #selector(menuCapture), "n", target: self)
        add(file, "Search…", #selector(menuSearch), "k", target: self)
        add(file, "Morning Brief", #selector(menuMorning), "b", target: self)

        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit"); editItem.submenu = edit
        add(edit, "Undo", Selector(("undo:")), "z"); add(edit, "Redo", Selector(("redo:")), "z", [.command, .shift])
        edit.addItem(.separator())
        add(edit, "Cut", #selector(NSText.cut(_:)), "x"); add(edit, "Copy", #selector(NSText.copy(_:)), "c")
        add(edit, "Paste", #selector(NSText.paste(_:)), "v"); add(edit, "Select All", #selector(NSText.selectAll(_:)), "a")

        let viewItem = NSMenuItem(); main.addItem(viewItem)
        let view = NSMenu(title: "View"); viewItem.submenu = view
        add(view, "Today", #selector(navToday), "1", target: self)
        add(view, "Promise Ledger", #selector(navLedger), "2", target: self)
        add(view, "Inbox", #selector(navInbox), "3", target: self)
        add(view, "People", #selector(navPeople), "4", target: self)

        let winItem = NSMenuItem(); main.addItem(winItem)
        let win = NSMenu(title: "Window"); winItem.submenu = win
        add(win, "Minimize", #selector(NSWindow.performMiniaturize(_:)), "m")
        add(win, "Jaffloop", #selector(menuOpen), "0", target: self)
        NSApp.windowsMenu = win
        NSApp.mainMenu = main
    }

    @objc func menuSearch() { openMain(); model.showSearch.toggle() }
    @objc func menuMorning() { openMorningBrief() }
    @objc func navToday() { openMain(); model.nav = .today }
    @objc func navLedger() { openMain(); model.nav = .ledger }
    @objc func navInbox() { openMain(); model.nav = .inbox }
    @objc func navPeople() { openMain(); model.nav = .people }
}
