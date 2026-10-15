import { app, Menu, nativeImage, nativeTheme, Tray, type Rectangle } from 'electron';
import path from 'node:path';
import { fmtShort, isSameDay, TimeFormat } from '../core/pure';
import { tomorrowNine } from './notify-plan';

export interface TrayHandlers {
  onToggle(): void;
  onCapture(): void;
  onOpen(): void;
  onSettings(): void;
  /** epoch ms notifications are paused until, or null */
  pausedUntil(): number | null;
  /** pause until the time, or resume with null */
  onPause(until: number | null): void;
}

/** The menu bar item: loop icon (template), clay dot + count when something is overdue or slipping. */
export class TrayController {
  private tray: Tray | null = null;
  private count = 0;
  /** replaces the count next to the icon (trayText 'next') */
  private text: string | null = null;
  /** when the popover last closed by itself (blur), so the click that closed it does not reopen it */
  lastBlurHide = 0;

  constructor(private h: TrayHandlers, private iconDir = path.join(app.getAppPath(), 'build', 'tray')) {}

  private image(name: string, template: boolean) {
    const img = nativeImage.createFromPath(path.join(this.iconDir, `${name}.png`)); // @2x is picked up next to it
    img.setTemplateImage(template);
    return img;
  }

  create(): void {
    if (this.tray) return;
    this.tray = new Tray(this.image('loopTemplate', true));
    this.tray.on('click', () => { if (Date.now() - this.lastBlurHide > 250) this.h.onToggle(); });
    this.tray.on('right-click', () => this.tray?.popUpContextMenu(this.menu()));
    nativeTheme.on('updated', () => this.render());
    this.render();
  }

  private menu(): Menu {
    const now = Date.now();
    const p = this.h.pausedUntil();
    const until = p !== null && p > now ? p : null;
    return Menu.buildFromTemplate([
      { label: 'Capture…', click: () => this.h.onCapture() },
      { label: 'Open Jaffloop', click: () => this.h.onOpen() },
      { label: 'Settings…', click: () => this.h.onSettings() },
      { type: 'separator' },
      ...(until !== null ? [{ label: `Paused until ${isSameDay(until, now) ? TimeFormat.clock(until) : fmtShort(until, 'EEE HH:mm')}`, enabled: false }] : []),
      {
        label: 'Pause notifications',
        submenu: [
          { label: '1 hour', click: () => this.h.onPause(Date.now() + 3600_000) },
          { label: 'Until tomorrow 09:00', click: () => this.h.onPause(tomorrowNine(Date.now())) },
          ...(until !== null ? [{ label: 'Resume', click: () => this.h.onPause(null) }] : []),
        ],
      },
      { type: 'separator' },
      { label: 'Quit Jaffloop', click: () => app.quit() },
    ]);
  }

  /** n = items overdue or slipping; text = what to show instead of the number, when there is one */
  setCount(n: number, text: string | null = null): void {
    this.count = n;
    this.text = text;
    this.render();
  }

  private render(): void {
    const t = this.tray;
    if (!t || t.isDestroyed()) return;
    const n = this.count;
    if (n > 0) t.setImage(this.image(nativeTheme.shouldUseDarkColors ? 'loopDotDark' : 'loopDotLight', false));
    else t.setImage(this.image('loopTemplate', true));
    t.setTitle(this.title(), { fontType: 'monospacedDigit' });
    t.setToolTip(n > 0 ? `${n} overdue or slipping` : 'Jaffloop');
  }

  private title(): string { return this.text ? ` ${this.text}` : this.count > 0 ? ` ${this.count}` : ''; }

  bounds(): Rectangle | undefined { return this.tray && !this.tray.isDestroyed() ? this.tray.getBounds() : undefined; }
  state(): { count: number; title: string; tooltip: string } { return { count: this.count, title: this.title(), tooltip: this.count > 0 ? `${this.count} overdue or slipping` : 'Jaffloop' }; }
  dispose(): void { this.tray?.destroy(); this.tray = null; }
}
