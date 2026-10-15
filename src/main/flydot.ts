import { BrowserWindow, nativeTheme, type Rectangle } from 'electron';

/** cubic-bezier(0.5, 0, 0.9, 0.6) like the Swift timing function, solved for x by bisection. */
export function ease(t: number, x1 = 0.5, y1 = 0, x2 = 0.9, y2 = 0.6): number {
  const bez = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (bez(x1, x2, mid) < t) lo = mid; else hi = mid; }
  return bez(y1, y2, (lo + hi) / 2);
}

/** A dot leaves `from` (screen point) and lands on the tray icon. Resolves when it has landed. */
export function flyDot(from: { x: number; y: number }, to: Rectangle, durationMs = 420): Promise<void> {
  return new Promise((resolve) => {
    const d = 12;
    const win = new BrowserWindow({
      x: Math.round(from.x - d / 2), y: Math.round(from.y - d / 2), width: d, height: d, show: false, frame: false, transparent: true,
      hasShadow: false, resizable: false, focusable: false, skipTaskbar: true, enableLargerThanScreen: true, backgroundColor: '#00000000',
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    const color = nativeTheme.shouldUseDarkColors ? '#f2f2f0' : '#1c1c1b';
    void win.loadURL(`data:text/html,${encodeURIComponent(`<body style="margin:0;background:transparent;overflow:hidden"><div style="width:100vw;height:100vh;border-radius:50%;background:${color}"></div></body>`)}`);
    const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
    // a curve: the control point sits above the straight line
    const c = { x: (from.x + end.x) / 2, y: Math.min(from.y, end.y) - 60 };
    const run = () => {
      if (win.isDestroyed()) return resolve();
      win.showInactive();
      const t0 = Date.now();
      const timer = setInterval(() => {
        const t = Math.min(1, (Date.now() - t0) / durationMs);
        const e = ease(t);
        const x = (1 - e) ** 2 * from.x + 2 * (1 - e) * e * c.x + e * e * end.x;
        const y = (1 - e) ** 2 * from.y + 2 * (1 - e) * e * c.y + e * e * end.y;
        const s = Math.max(6, Math.round(d - (d - 6) * e));
        if (!win.isDestroyed()) win.setBounds({ x: Math.round(x - s / 2), y: Math.round(y - s / 2), width: s, height: s });
        if (t >= 1) { clearInterval(timer); if (!win.isDestroyed()) win.destroy(); resolve(); }
      }, 16);
    };
    win.webContents.once('did-finish-load', run);
    // never leave a stray window behind
    setTimeout(() => { if (!win.isDestroyed()) { win.destroy(); resolve(); } }, durationMs + 3000).unref();
  });
}
