import { globalShortcut } from 'electron';
import { hotkeyToAccelerator } from '../core/pure';

/** The global capture shortcut. `register` keeps the previous shortcut when the new one is invalid or taken. */
export class Hotkey {
  private current: string | null = null;
  constructor(private onFire: () => void) {}

  register(accelerator: string): boolean {
    const acc = hotkeyToAccelerator(accelerator.trim());
    if (!acc) return false;
    if (acc === this.current && globalShortcut.isRegistered(acc)) return true;
    const previous = this.current;
    if (previous) globalShortcut.unregister(previous);
    let ok = false;
    try { ok = globalShortcut.register(acc, this.onFire); } catch { ok = false; }
    if (ok) { this.current = acc; return true; }
    if (previous) {
      try { if (globalShortcut.register(previous, this.onFire)) this.current = previous; else this.current = null; } catch { this.current = null; }
    }
    return false;
  }

  accelerator(): string | null { return this.current; }
  dispose(): void { globalShortcut.unregisterAll(); this.current = null; }
}
