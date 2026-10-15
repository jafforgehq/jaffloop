import SwiftUI
import AppKit
import Combine
import JaffloopCore

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var model: AppModel!
    let hotkey = HotkeyManager()
    let notifier = NotificationService()
    var capturePanel: CapturePanel!
    var statusItem: NSStatusItem!
    let popover = NSPopover()
    var mainWindow: NSWindow?
    var settingsWindow: NSWindow?
    var briefWindow: NSWindow?
    var cancellables = Set<AnyCancellable>()

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
        NSApp.appearance = model.appearance.nsAppearance
        buildMenu()
        wireModel()
        setupStatusItem()

        capturePanel = CapturePanel(model: model) { [weak self] in self?.capturePanel.orderOut(nil) }
        hotkey.onFire = { [weak self] in self?.toggleCapture() }
        hotkey.register(model.settings.hotkey)

        notifier.model = model
        notifier.start()
        notifier.reschedule()
        model.startWatching()
        model.updates.checkIfDue(enabled: model.autoUpdateCheck)

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
        model.$captureBlip.dropFirst().sink { [weak self] _ in self?.flyDot() }.store(in: &cancellables)
        model.$appearance.dropFirst().sink { a in NSApp.appearance = a.nsAppearance }.store(in: &cancellables)
        model.$nav.sink { [weak self] n in self?.mainWindow?.title = self?.model.navTitle(n) ?? "Jaffloop" }.store(in: &cancellables)
    }

    func toggleCapture() {
        if capturePanel.isVisible { capturePanel.orderOut(nil) } else { showCapture() }
    }

    func showCapture() { capturePanel.present() }

    // MARK: status item

    func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.imagePosition = .imageLeft
        statusItem.button?.font = .monospacedDigitSystemFont(ofSize: 12, weight: .medium)
        statusItem.button?.image = LoopIcon.image(dot: false)
        statusItem.button?.target = self
        statusItem.button?.action = #selector(statusClicked)
        statusItem.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        statusItem.button?.wantsLayer = true
        popover.behavior = .transient
        popover.contentViewController = NSHostingController(rootView: PopoverView().environmentObject(model))
        updateStatusIcon()
    }

    func updateStatusIcon() {
        let n = model.overdueCount
        statusItem?.button?.image = LoopIcon.image(dot: n > 0)
        statusItem?.button?.title = n > 0 ? " \(n)" : ""
        statusItem?.button?.toolTip = n > 0 ? "\(n) overdue or slipping" : "Jaffloop"
    }

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

    /// A dot leaves the capture card and lands on the menu bar icon, which then blips.
    func flyDot() {
        guard !Motion.reduced, let target = statusItem.button?.window?.frame else { blip(); return }
        let start: NSPoint
        if capturePanel.isVisible { start = NSPoint(x: capturePanel.frame.minX + 58, y: capturePanel.frame.maxY - 50) }
        else if let w = NSApp.keyWindow { start = NSPoint(x: w.frame.midX, y: w.frame.minY + 40) }
        else { blip(); return }
        let d: CGFloat = 12
        let w = NSWindow(contentRect: NSRect(x: start.x - d / 2, y: start.y - d / 2, width: d, height: d), styleMask: .borderless, backing: .buffered, defer: false)
        w.isOpaque = false; w.backgroundColor = .clear; w.hasShadow = false; w.level = .statusBar
        w.ignoresMouseEvents = true; w.isReleasedWhenClosed = false
        let v = NSView(frame: NSRect(x: 0, y: 0, width: d, height: d))
        v.wantsLayer = true; v.layer?.cornerRadius = d / 2
        v.layer?.backgroundColor = NSColor.labelColor.cgColor
        w.contentView = v
        w.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.42
            ctx.timingFunction = CAMediaTimingFunction(controlPoints: 0.5, 0, 0.9, 0.6)
            w.animator().setFrame(NSRect(x: target.midX - 3, y: target.midY - 3, width: 6, height: 6), display: true)
        }, completionHandler: { [weak self] in
            w.orderOut(nil)
            self?.blip()
        })
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
            w.titleVisibility = .visible
            w.title = model.navTitle(model.nav)
            w.setFrameAutosaveName("JaffloopMain")
            w.center()
            mainWindow = w
        }
        NSApp.activate(ignoringOtherApps: true)
        mainWindow?.makeKeyAndOrderFront(nil)
    }

    func openSettings() {
        if settingsWindow == nil {
            settingsWindow = host(SettingsView(onHotkeyChange: { [weak self] in
                guard let self else { return false }
                return self.hotkey.register(self.model.settings.hotkey)
            }), size: NSSize(width: 560, height: 460), title: "Jaffloop Settings")
        }
        NSApp.activate(ignoringOtherApps: true)
        settingsWindow?.makeKeyAndOrderFront(nil)
    }

    func openMorningBrief() {
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
        add(app, "Check for Updates…", #selector(menuUpdates), target: self)
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
        add(edit, "Undo", #selector(menuUndo), "z", target: self); add(edit, "Redo", Selector(("redo:")), "z", [.command, .shift])
        edit.addItem(.separator())
        add(edit, "Cut", #selector(NSText.cut(_:)), "x"); add(edit, "Copy", #selector(NSText.copy(_:)), "c")
        add(edit, "Paste", #selector(NSText.paste(_:)), "v"); add(edit, "Select All", #selector(NSText.selectAll(_:)), "a")

        let viewItem = NSMenuItem(); main.addItem(viewItem)
        let view = NSMenu(title: "View"); viewItem.submenu = view
        add(view, "Today", #selector(navToday), "1", target: self)
        add(view, "Promise Ledger", #selector(navLedger), "2", target: self)
        add(view, "Inbox", #selector(navInbox), "3", target: self)
        add(view, "People", #selector(navPeople), "4", target: self)
        view.addItem(.separator())
        add(view, "Back", #selector(menuBack), "[", target: self)
        add(view, "Forward", #selector(menuForward), "]", target: self)
        add(view, "Hide or Show Sidebar", #selector(menuSidebar), "\\", target: self)

        let winItem = NSMenuItem(); main.addItem(winItem)
        let win = NSMenu(title: "Window"); winItem.submenu = win
        add(win, "Minimize", #selector(NSWindow.performMiniaturize(_:)), "m")
        add(win, "Jaffloop", #selector(menuOpen), "0", target: self)
        NSApp.windowsMenu = win

        let helpItem = NSMenuItem(); main.addItem(helpItem)
        let help = NSMenu(title: "Help"); helpItem.submenu = help
        add(help, "Keyboard Shortcuts", #selector(menuShortcuts), "/", target: self)
        add(help, "What's New and Roadmap", #selector(menuWhatsNew), target: self)
        NSApp.helpMenu = help
        NSApp.mainMenu = main
    }

    @objc func menuBack() { openMain(); model.goBack() }
    @objc func menuForward() { openMain(); model.goForward() }
    @objc func menuSidebar() { openMain(); model.toggleSidebar() }
    @objc func menuShortcuts() { openMain(); withAnimation(Motion.ease(0.2)) { model.showShortcuts.toggle() } }
    @objc func menuWhatsNew() { openMain(); model.nav = .releases }
    @objc func menuUpdates() { openMain(); model.nav = .releases; model.updates.check() }
    /// ⌘Z undoes the last action while its toast is showing, otherwise text undo as usual.
    @objc func menuUndo() {
        if model.toast?.undo != nil { model.undoLast() } else { NSApp.sendAction(Selector(("undo:")), to: nil, from: nil) }
    }

    @objc func menuSearch() { openMain(); model.showSearch.toggle() }
    @objc func menuMorning() { openMorningBrief() }
    @objc func navToday() { openMain(); model.nav = .today }
    @objc func navLedger() { openMain(); model.nav = .ledger }
    @objc func navInbox() { openMain(); model.nav = .inbox }
    @objc func navPeople() { openMain(); model.nav = .people }
}
