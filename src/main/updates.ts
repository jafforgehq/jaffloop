import type { UpdateState, UpdateStatus } from '../shared/api';
import { cleanVersion, isNewer, promptText, shouldAsk, type PromptText } from './update-policy';

/**
 * The update flow, with everything that touches the outside world injected (the updater, the dialog), so it is tested with
 * fakes. Policy (copied from Jaffer): check shortly after launch and every few hours, download in the background, then
 * show "Restart to update" and a dialog whose default is Later.
 */

export interface UpdaterLike {
  on(ev: 'checking-for-update' | 'update-available' | 'update-not-available' | 'update-downloaded' | 'download-progress' | 'error', cb: (arg?: any) => void): unknown;
  checkForUpdates(): Promise<{ downloadPromise?: Promise<unknown> | null } | null | undefined | void>;
  quitAndInstall(silent?: boolean, forceRun?: boolean): void;
}

export interface UpdateDeps {
  updater: UpdaterLike;
  /** The running version. */
  current: string;
  /** False for builds that cannot update themselves (dev, unsigned, ad-hoc). */
  enabled: boolean;
  /** Settings -> About -> Check automatically. */
  auto: () => boolean;
  /** Show the prompt; true = update now. `manual` says the user asked for it (bring the window forward). */
  ask(text: () => PromptText, version: string, manual: boolean): Promise<boolean>;
  /** Called right before the install. */
  prepareInstall?(): Promise<void>;
  log(msg: string): void;
  onState?(s: UpdateState): void;
  /** Shown instead of a generic message when `enabled` is false. */
  unavailableReason?: string;
  firstCheckMs?: number;
  intervalMs?: number;
  /** A check that has not answered by then counts as failed (default 90 s). */
  checkTimeoutMs?: number;
  /** A download with no progress for this long counts as stalled (default 15 min). */
  downloadStallMs?: number;
}

const MAX_ERROR = 200;
const DOWNLOAD_GRACE_MS = 1500;

export class UpdateController {
  private status: UpdateStatus;
  private version: string | undefined;
  private error: string | undefined;
  private notes: string | undefined;
  private progress: number | undefined;
  private lastChecked: number | undefined;
  private declined: string | null = null;
  private asking = false;
  private manual = false;
  private running: Promise<UpdateState> | null = null;
  private timers: NodeJS.Timeout[] = [];
  private last = '';
  private lastActivity = 0;

  constructor(private d: UpdateDeps) {
    this.status = d.enabled ? 'idle' : 'unavailable';
    if (!d.enabled) return;
    const u = d.updater;
    u.on('checking-for-update', () => {
      this.lastChecked = Date.now();
      if (this.status !== 'ready' && this.status !== 'downloading') this.set('checking');
    });
    u.on('update-available', (info) => {
      const v = this.usable(info?.version);
      if (v && !(this.status === 'ready' && this.version === v)) {
        this.notes = notesOf(info?.releaseNotes);
        this.progress = 0;
        this.set('downloading', { version: v });
      }
    });
    u.on('update-not-available', () => {
      if (this.status !== 'ready') this.set('uptodate');
    });
    u.on('download-progress', (p) => {
      this.lastActivity = Date.now();
      if (this.status === 'downloading' && typeof p?.percent === 'number') {
        this.progress = Math.max(0, Math.min(100, Math.round(p.percent)));
        this.set('downloading', { version: this.version });
      }
    });
    u.on('update-downloaded', (info) => {
      const v = this.usable(info?.version);
      if (!v) return;
      this.notes = notesOf(info?.releaseNotes) ?? this.notes;
      this.progress = 100;
      this.set('ready', { version: v });
      void this.offer(v);
    });
    u.on('error', (e) => this.onError(e));
  }

  state(): UpdateState {
    const s: UpdateState = { status: this.status, current: this.d.current };
    if (this.version) s.version = this.version;
    if (this.status === 'downloading' && this.progress !== undefined) s.progress = this.progress;
    const error = this.status === 'unavailable' ? this.d.unavailableReason : this.error;
    if (error) s.error = error;
    if ((this.status === 'ready' || this.status === 'downloading') && this.notes) s.notes = this.notes;
    if (this.lastChecked) s.lastChecked = this.lastChecked;
    return s;
  }

  start(): void {
    if (!this.d.enabled || this.timers.length) return;
    const tick = () => {
      if (this.d.auto()) void this.check(false);
    };
    const first = setTimeout(tick, this.d.firstCheckMs ?? 15_000);
    const every = setInterval(tick, this.d.intervalMs ?? 6 * 3600_000);
    first.unref?.();
    every.unref?.();
    this.timers = [first, every];
  }

  stop(): void {
    for (const t of this.timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    this.timers = [];
  }

  /** A check the user asked for: always answers, and asks again about an update that is already waiting. */
  checkNow(): Promise<UpdateState> {
    return this.check(true);
  }

  /** A check that follows the background rules (not asked for by the user). */
  checkBackground(): Promise<UpdateState> {
    return this.check(false);
  }

  /** Install the downloaded update (the sidebar's "Restart to update"). */
  async installNow(): Promise<void> {
    if (this.status !== 'ready') return;
    await this.d.prepareInstall?.();
    this.d.updater.quitAndInstall(false, true);
  }

  private usable(v: unknown): string | null {
    const clean = cleanVersion(v);
    if (clean && isNewer(clean, this.d.current)) return clean;
    this.d.log(`ignored version from the feed: ${typeof v === 'string' ? v.slice(0, 40) : typeof v}`);
    return null;
  }

  private set(status: UpdateStatus, o: { version?: string; error?: string } = {}): void {
    this.status = status;
    if (status === 'downloading') this.lastActivity = Date.now();
    this.version = o.version ?? (status === 'ready' || status === 'downloading' ? this.version : undefined);
    this.error = o.error;
    if (status !== 'ready' && status !== 'downloading') {
      this.notes = undefined;
      this.progress = undefined;
    }
    const s = this.state();
    const key = JSON.stringify({ ...s, lastChecked: 0 });
    if (key === this.last) return;
    this.last = key;
    this.d.onState?.(s);
  }

  private onError(e: unknown): void {
    const msg = (e instanceof Error ? e.message : String(e ?? 'unknown error')).replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR);
    this.d.log(`update error: ${msg}`);
    if (this.status === 'ready') return; // the downloaded update is still good; a failed later check must not hide it
    this.set('error', { error: msg });
  }

  private check(manual: boolean): Promise<UpdateState> {
    if (!this.d.enabled) return Promise.resolve(this.state());
    if (manual) {
      if (this.status === 'ready' && this.version) {
        this.manual = true;
        void this.offer(this.version);
        return Promise.resolve(this.state());
      }
    }
    if (this.status === 'downloading' && !this.stalled()) return Promise.resolve(this.state());
    if (this.running) {
      if (manual) this.manual = true; // the user asked while a background check was running: the answer is for them
      return this.running;
    }
    this.manual = manual;
    this.running = (async () => {
      this.error = undefined;
      try {
        const r = await this.withTimeout(this.d.updater.checkForUpdates());
        const download = r && r.downloadPromise ? r.downloadPromise.catch((e) => void this.onError(e)) : null; // always handled: a failed background download is not an unhandled rejection
        if (manual && this.status === 'downloading' && download) {
          // an update downloaded earlier is "downloaded" again within moments; wait briefly so the answer is "ready"
          await Promise.race([download, new Promise((res) => setTimeout(res, DOWNLOAD_GRACE_MS))]);
        }
        if (this.status === 'checking') this.set('uptodate');
      } catch (e) {
        this.onError(e);
      } finally {
        this.running = null;
      }
      return this.state();
    })();
    return this.running;
  }

  private stalled(): boolean {
    return Date.now() - this.lastActivity > (this.d.downloadStallMs ?? 15 * 60_000);
  }

  /** The updater library has no working request timeout under Electron, so a stuck network call must not stick the controller too. */
  private withTimeout<T>(p: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('The check timed out')), this.d.checkTimeoutMs ?? 90_000);
    });
    return Promise.race([p, limit]).finally(() => clearTimeout(timer));
  }

  private async offer(version: string): Promise<void> {
    const manual = this.manual;
    this.manual = false;
    if (this.asking || !shouldAsk({ manual, declined: this.declined, version })) return;
    this.asking = true;
    try {
      const yes = await this.d.ask(() => promptText({ version: this.version ?? version }), version, manual);
      if (!yes) {
        this.declined = version;
        return;
      }
      await this.d.prepareInstall?.();
      this.d.updater.quitAndInstall(false, true);
    } catch (e) {
      this.d.log(`update prompt failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.asking = false;
    }
  }
}

/** electron-updater gives a string, or an array of { version, note } for several releases. */
function notesOf(n: unknown): string | undefined {
  if (typeof n === 'string') return n.slice(0, 4000) || undefined;
  if (Array.isArray(n)) {
    const t = n.map((x) => (x && typeof x === 'object' && typeof (x as { note?: unknown }).note === 'string' ? (x as { note: string }).note : '')).filter(Boolean).join('\n\n');
    return t ? t.slice(0, 4000) : undefined;
  }
  return undefined;
}
