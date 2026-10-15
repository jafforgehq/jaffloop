import { app, Menu, nativeImage, nativeTheme, Tray, type Rectangle } from 'electron';
import path from 'node:path';

export interface TrayHandlers {
  onToggle(): void;
  onCapture(): void;
  onOpen(): void;
  onSettings(): void;
}

/** The menu bar item: loop icon (template), clay dot + count when something is overdue or slipping. */
export class TrayController {
  private tray: Tray | null = null;
  private count = 0;
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
    return Menu.buildFromTemplate([
      { label: 'Capture…', click: () => this.h.onCapture() },
      { label: 'Open Jaffloop', click: () => this.h.onOpen() },
      { label: 'Settings…', click: () => this.h.onSettings() },
      { type: 'separator' },
      { label: 'Quit Jaffloop', click: () => app.quit() },
    ]);
  }

  /** n = items overdue or slipping */
  setCount(n: number): void {
    this.count = n;
    this.render();
  }

  private render(): void {
    const t = this.tray;
    if (!t || t.isDestroyed()) return;
    const n = this.count;
    if (n > 0) t.setImage(this.image(nativeTheme.shouldUseDarkColors ? 'loopDotDark' : 'loopDotLight', false));
    else t.setImage(this.image('loopTemplate', true));
    t.setTitle(n > 0 ? ` ${n}` : '', { fontType: 'monospacedDigit' });
    t.setToolTip(n > 0 ? `${n} overdue or slipping` : 'Jaffloop');
  }

  bounds(): Rectangle | undefined { return this.tray && !this.tray.isDestroyed() ? this.tray.getBounds() : undefined; }
  state(): { count: number; title: string; tooltip: string } { return { count: this.count, title: this.count > 0 ? ` ${this.count}` : '', tooltip: this.count > 0 ? `${this.count} overdue or slipping` : 'Jaffloop' }; }
  dispose(): void { this.tray?.destroy(); this.tray = null; }
}
