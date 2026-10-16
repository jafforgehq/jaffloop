// Every BrowserWindow of the app: one renderer bundle, told apart by ?view=.
import { BrowserWindow, nativeTheme, screen, shell, systemPreferences, type Rectangle, type WebContents } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ApiEventName, ApiEvents, SettingsTab, WindowKind } from '../shared/api';
import { readJson, writeJsonAtomic } from './ui-state';

export interface WindowsOptions {
  preload: string;
  /** dist/renderer */
  rendererDir: string;
  /** where the main window's bounds are remembered */
  boundsFile: string;
  /** the theme's background colour, so opaque windows do not flash another shade while loading */
  windowBackground?(): string;
  /** the tray icon's bounds, for anchoring the popover */
  trayBounds(): Rectangle | undefined;
  /** the popover closed by itself (lost focus) */
  onPopoverBlurHide?(): void;
  onCaptureShown?(): void;
}

const CAPTURE = { width: 640, height: 380 };
const POPOVER = { width: 400, height: 460 };

export class Windows {
  private main: BrowserWindow | null = null;
  private capture: BrowserWindow | null = null;
  private popover: BrowserWindow | null = null;
  private settings: BrowserWindow | null = null;
  private brief: BrowserWindow | null = null;
  private all = new Set<BrowserWindow>();
  /** windows whose renderer finished initModel (document.body.dataset.ready) */
  private readyAt = new WeakMap<BrowserWindow, Promise<void>>();
  private settingsTab: string | null = null;

  constructor(private o: WindowsOptions) {}

  // ------------------------------------------------------------ plumbing

  url(view: WindowKind, params: Record<string, string> = {}): string {
    const u = pathToFileURL(path.join(this.o.rendererDir, 'index.html'));
    u.searchParams.set('view', view);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.href;
  }

  private make(view: WindowKind, params: Record<string, string>, opts: Electron.BrowserWindowConstructorOptions): BrowserWindow {
    const win = new BrowserWindow({
      show: false,
      ...opts,
      webPreferences: { preload: this.o.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, ...opts.webPreferences },
    });
    this.all.add(win);
    win.on('closed', () => this.all.delete(win));
    // links never navigate the app window; they open in the browser
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:\/\//i.test(url)) void shell.openExternal(url); } });
    this.readyAt.set(win, this.watchReady(win));
    void win.loadURL(this.url(view, params));
    return win;
  }

  /** Resolves when the renderer sets body[data-ready] (or has rendered into #root: the capture window never sets the flag), or after 4 s, whichever comes first (a broken renderer must not block events forever). */
  private watchReady(win: BrowserWindow): Promise<void> {
    return new Promise((resolve) => {
      const started = Date.now();
      const poll = async () => {
        if (win.isDestroyed()) return resolve();
        try {
          if (!win.webContents.isLoading() && (await win.webContents.executeJavaScript(`document.body && (document.body.dataset.ready === '1' || (document.getElementById('root')?.childElementCount ?? 0) > 0)`))) return resolve();
        } catch { /* page not ready yet */ }
        if (Date.now() - started > 4000) return resolve();
        setTimeout(poll, 40);
      };
      void poll();
    });
  }

  whenReady(win: BrowserWindow): Promise<void> { return this.readyAt.get(win) ?? Promise.resolve(); }

  /** To every window (and only those): 'evt:<name>'. */
  broadcast<E extends ApiEventName>(event: E, ...payload: ApiEvents[E] extends undefined ? [] : [ApiEvents[E]]): void {
    for (const w of this.all) if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(`evt:${event}`, payload[0]);
  }

  /** To one window, once its renderer is up. */
  sendWhenReady<E extends ApiEventName>(win: BrowserWindow, event: E, ...payload: ApiEvents[E] extends undefined ? [] : [ApiEvents[E]]): void {
    void this.whenReady(win).then(() => { if (!win.isDestroyed()) win.webContents.send(`evt:${event}`, payload[0]); });
  }

  windowOf(sender: WebContents): BrowserWindow | null { return BrowserWindow.fromWebContents(sender); }
  list(): BrowserWindow[] { return [...this.all].filter((w) => !w.isDestroyed()); }

  // ------------------------------------------------------------ main

  mainWindow(): BrowserWindow | null { return this.main && !this.main.isDestroyed() ? this.main : null; }

  /** Show (creating if needed) the main window. `nav` for an existing window goes out as 'navigate'; for a new one the caller sets ui lastNav first. */
  openMain(nav?: string): BrowserWindow {
    let w = this.mainWindow();
    const created = !w;
    if (!w) {
      const b = this.loadBounds();
      const solid = nativeTheme.prefersReducedTransparency;
      w = this.make('main', {}, {
        width: b?.width ?? 1080, height: b?.height ?? 700, x: b?.x, y: b?.y, minWidth: 940, minHeight: 560,
        title: 'Jaffloop', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 },
        ...(solid ? { backgroundColor: this.background() } : { vibrancy: 'sidebar' as const, visualEffectState: 'followWindow' as const, backgroundColor: '#00000000' }),
      });
      this.main = w;
      const save = debounce(() => { if (w && !w.isDestroyed() && !w.isMinimized() && !w.isFullScreen()) writeJsonAtomic(this.o.boundsFile, w.getBounds()); }, 400);
      w.on('resize', save);
      w.on('move', save);
      w.on('closed', () => { if (this.main === w) this.main = null; });
      w.once('ready-to-show', () => { if (w && !w.isDestroyed()) { w.show(); w.focus(); } });
    } else {
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
    }
    if (nav && !created) this.sendWhenReady(w, 'navigate', nav);
    return w;
  }

  private loadBounds(): Rectangle | undefined {
    const b = readJson<Rectangle | null>(this.o.boundsFile, null);
    if (!b || !(b.width > 0) || !(b.height > 0)) return undefined;
    const visible = screen.getAllDisplays().some((d) => b.x >= d.bounds.x - 50 && b.y >= d.bounds.y - 50 && b.x < d.bounds.x + d.bounds.width && b.y < d.bounds.y + d.bounds.height);
    return visible ? b : { width: b.width, height: b.height, x: undefined as unknown as number, y: undefined as unknown as number };
  }

  // ------------------------------------------------------------ capture panel

  captureWindow(): BrowserWindow | null { return this.capture && !this.capture.isDestroyed() ? this.capture : null; }
  captureVisible(): boolean { return !!this.captureWindow()?.isVisible(); }

  /** Created hidden and kept, so the hotkey answers instantly. */
  warmCapture(): BrowserWindow {
    let w = this.captureWindow();
    if (w) return w;
    w = this.make('capture', {}, {
      ...CAPTURE, frame: false, transparent: true, hasShadow: false, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, type: 'panel', backgroundColor: '#00000000',
    });
    w.setAlwaysOnTop(true, 'floating');
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    w.on('blur', () => { if (!w!.isDestroyed()) w!.hide(); });
    this.capture = w;
    return w;
  }

  showCapture(): void {
    const w = this.warmCapture();
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const f = display.bounds;
    // the Swift panel sat 28% from the top, minus 60 pt of its own padding
    const x = Math.round(f.x + (f.width - CAPTURE.width) / 2);
    const y = Math.max(f.y + 20, Math.round(f.y + f.height * 0.28 - 60));
    w.setBounds({ x, y, ...CAPTURE });
    void this.whenReady(w).then(() => {
      if (w.isDestroyed()) return;
      w.show();
      w.focus();
      w.webContents.send('evt:capture-shown');
      this.o.onCaptureShown?.();
    });
  }

  hideCapture(): void { const w = this.captureWindow(); if (w?.isVisible()) w.hide(); }
  toggleCapture(): void { if (this.captureVisible()) this.hideCapture(); else this.showCapture(); }

  // ------------------------------------------------------------ tray popover

  popoverWindow(): BrowserWindow | null { return this.popover && !this.popover.isDestroyed() ? this.popover : null; }

  togglePopover(): void {
    const existing = this.popoverWindow();
    if (existing?.isVisible()) { existing.hide(); return; }
    const w = existing ?? this.makePopover();
    this.positionPopover(w);
    void this.whenReady(w).then(() => { if (!w.isDestroyed()) { this.positionPopover(w); w.show(); w.focus(); } });
  }

  private makePopover(): BrowserWindow {
    const w = this.make('popover', {}, {
      ...POPOVER, frame: false, transparent: true, hasShadow: true, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#00000000',
    });
    w.setAlwaysOnTop(true, 'pop-up-menu');
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    w.on('blur', () => { if (!w.isDestroyed() && w.isVisible()) { w.hide(); this.o.onPopoverBlurHide?.(); } });
    this.popover = w;
    return w;
  }

  private positionPopover(w: BrowserWindow): void {
    const tb = this.o.trayBounds();
    const display = tb ? screen.getDisplayMatching(tb) : screen.getPrimaryDisplay();
    const wa = display.workArea;
    let x = tb ? Math.round(tb.x + tb.width / 2 - POPOVER.width / 2) : wa.x + wa.width - POPOVER.width - 8;
    x = Math.min(Math.max(x, wa.x + 6), wa.x + wa.width - POPOVER.width - 6);
    const y = tb ? tb.y + tb.height + 4 : wa.y + 4;
    w.setBounds({ x, y, ...POPOVER });
  }

  hidePopover(): void { const w = this.popoverWindow(); if (w?.isVisible()) w.hide(); }

  // ------------------------------------------------------------ settings and briefs

  openSettings(tab?: SettingsTab): void {
    const t = tab ?? 'general';
    let w = this.settings && !this.settings.isDestroyed() ? this.settings : null;
    if (w && this.settingsTab !== t && tab) { this.settingsTab = t; void w.loadURL(this.url('settings', { tab: t })); }
    if (!w) {
      this.settingsTab = t;
      w = this.make('settings', tab ? { tab } : {}, { width: 560, height: 460, title: 'Jaffloop Settings', resizable: false, minimizable: true, maximizable: false, fullscreenable: false, ...this.chrome() });
      const win = w;
      win.once('ready-to-show', () => { if (!win.isDestroyed()) { win.show(); win.focus(); } });
      win.on('closed', () => { if (this.settings === win) this.settings = null; });
      this.settings = win;
      win.center();
      return;
    }
    w.show();
    w.focus();
  }

  private openBrief(view: 'brief' | 'morning', params: Record<string, string>, title: string): void {
    this.brief?.close();
    const w = this.make(view, params, { width: 620, height: 560, title, minWidth: 420, minHeight: 360, fullscreenable: false, ...this.chrome() });
    w.once('ready-to-show', () => { if (!w.isDestroyed()) { w.show(); w.focus(); } });
    w.on('closed', () => { if (this.brief === w) this.brief = null; });
    this.brief = w;
    w.center();
  }
  openPersonBrief(personId: string, name = 'Person'): void { this.openBrief('brief', { personId }, `Brief: ${name}`); }
  openMorning(): void { this.openBrief('morning', {}, 'Morning brief'); }

  private chrome(): Electron.BrowserWindowConstructorOptions {
    return { backgroundColor: this.background() };
  }

  private background(): string { return this.o.windowBackground?.() ?? (nativeTheme.shouldUseDarkColors ? '#1c1c1b' : '#f7f6f3'); }

  // ------------------------------------------------------------ misc

  /** Windows a user would call "the app" (not the hidden capture panel or popover). */
  visibleAppWindows(): BrowserWindow[] { return this.list().filter((w) => w !== this.capture && w !== this.popover && w.isVisible()); }
  reducedMotion(): boolean { try { return systemPreferences.getAnimationSettings().prefersReducedMotion; } catch { return false; } }
  /** best-effort cleanup for tests */
  closeAll(): void { for (const w of this.list()) w.destroy(); }
}

function debounce(fn: () => void, ms: number): () => void {
  let t: NodeJS.Timeout | undefined;
  return () => { clearTimeout(t); t = setTimeout(fn, ms); };
}
