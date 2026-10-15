// Turns the plan from notify-plan.ts into timers and native notifications. Electron has no scheduled local notifications,
// so timers are recomputed on every data change (debounced), on wake from sleep, and hourly.
import { Notification, powerMonitor } from 'electron';
import type { Item, Settings } from '../shared/types';
import { isOverdue } from '../core/pure';
import { planNotifications, type Planned } from './notify-plan';
import { readJson, writeJsonAtomic } from './ui-state';

export interface NotifierDeps {
  items(): Item[];
  item(id: string): Item | null;
  people(): Map<string, string>;
  settings(): Settings;
  /** small json with the stale waiting-on ids that already had their notice */
  stateFile: string;
  done(id: string): void;
  snooze(ids: string[], untilMs: number): void;
  /** copy a nudge text to the clipboard */
  nudge(text: string): void;
  openLedger(): void;
  openMorning(): void;
  /** open the person's page (or Today) and select the item */
  openItem(item: Item | null): void;
}

const HOUR = 3600_000;
const MAX_TIMEOUT = 2 ** 31 - 1;

export class Notifier {
  private timers = new Map<string, { at: number; timer: NodeJS.Timeout }>();
  private debounce: NodeJS.Timeout | undefined;
  private hourly: NodeJS.Timeout | undefined;
  private live = new Set<Notification>();
  private notified: Set<string>;

  constructor(private d: NotifierDeps, private now: () => number = Date.now, private enabled = Notification.isSupported()) {
    this.notified = new Set(readJson<string[]>(d.stateFile, []));
  }

  start(): void {
    this.reschedule();
    this.hourly = setInterval(() => this.rebuild(), HOUR);
    this.hourly.unref();
    powerMonitor.on('resume', () => this.reschedule());
  }

  stop(): void {
    clearTimeout(this.debounce);
    clearInterval(this.hourly);
    for (const t of this.timers.values()) clearTimeout(t.timer);
    this.timers.clear();
  }

  /** Debounced (600 ms); call it on every data or settings change. */
  reschedule(): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.rebuild(), 600);
  }

  /** The currently scheduled ids (for tests). */
  scheduled(): Array<{ id: string; at: number }> { return [...this.timers].map(([id, t]) => ({ id, at: t.at })).sort((a, b) => a.at - b.at); }

  rebuild(): void {
    const now = this.now();
    const plan = planNotifications({ items: this.d.items(), people: this.d.people(), settings: this.d.settings(), now, notified: this.notified });
    const wanted = new Map(plan.map((p) => [p.id, p]));
    for (const [id, t] of this.timers) if (!wanted.has(id)) { clearTimeout(t.timer); this.timers.delete(id); }
    for (const p of plan) {
      const have = this.timers.get(p.id);
      // a stale notice is planned "30 s from now" on every rebuild: keep the first timer, or it would never fire
      if (have && (have.at === p.at || p.kind === 'stale' || p.at - now <= 2500)) continue;
      if (have) clearTimeout(have.timer);
      const delay = p.at - now;
      if (delay > MAX_TIMEOUT) continue; // replanned by the hourly rebuild once it is near
      const timer = setTimeout(() => { this.timers.delete(p.id); this.fire(p); }, Math.max(0, delay));
      timer.unref();
      this.timers.set(p.id, { at: p.at, timer });
    }
  }

  private markStale(id: string): void {
    this.notified.add(id);
    try { writeJsonAtomic(this.d.stateFile, [...this.notified]); } catch { /* the notice may repeat after a restart; not worth failing */ }
  }

  private fire(p: Planned): void {
    if (p.kind === 'stale' && p.itemId) {
      this.markStale(p.itemId);
      if (!this.d.item(p.itemId) || this.d.item(p.itemId)!.status !== 'open') return;
    }
    if (!this.enabled) return;
    const actions = ACTIONS[p.kind];
    const n = new Notification({ title: p.title, body: p.body, silent: true, actions: actions.map((a) => ({ type: 'button' as const, text: a.text })) });
    this.live.add(n);
    n.on('click', () => this.act(p, 'open'));
    n.on('action', (_e, index) => this.act(p, actions[index]?.id ?? 'open'));
    n.on('close', () => this.live.delete(n));
    n.show();
  }

  /** Handles a click on the notification or one of its buttons. Exposed for tests. */
  act(p: Planned, action: string): void {
    const item = p.itemId ? this.d.item(p.itemId) : null;
    const now = this.now();
    switch (action) {
      case 'done': case 'received': if (item) this.d.done(item.id); break;
      case 'snooze': if (item) this.d.snooze([item.id], now + HOUR); break;
      case 'snoozeAll': {
        const today = new Date(now); today.setHours(0, 0, 0, 0);
        const end = today.getTime() + 24 * HOUR;
        const ids = this.d.items().filter((i) => i.kind === 'owe' && i.status === 'open' && (isOverdue(i, now) || (i.dueAt !== null && i.dueAt >= today.getTime() && i.dueAt < end))).map((i) => i.id);
        if (ids.length) this.d.snooze(ids, now + HOUR);
        break;
      }
      case 'nudge':
        if (item?.personId) {
          const name = this.d.people().get(item.personId);
          if (name) this.d.nudge(`Hi ${name.split(' ')[0] ?? name}, quick check-in on ${item.title}. Any update?`);
        }
        break;
      case 'openLedger': this.d.openLedger(); break;
      case 'openMorning': this.d.openMorning(); break;
      default:
        if (p.kind === 'morning') this.d.openMorning();
        else if (p.kind === 'due' || p.kind === 'batch') this.d.openLedger();
        else this.d.openItem(item);
    }
  }
}

const ACTIONS: Record<Planned['kind'], Array<{ id: string; text: string }>> = {
  reminder: [{ id: 'done', text: 'Done' }, { id: 'snooze', text: 'Snooze 1h' }, { id: 'open', text: 'Open' }],
  batch: [{ id: 'openLedger', text: 'Open ledger' }, { id: 'snoozeAll', text: 'Snooze all' }],
  due: [{ id: 'openLedger', text: 'Open ledger' }, { id: 'snoozeAll', text: 'Snooze all' }],
  stale: [{ id: 'received', text: 'Mark received' }, { id: 'nudge', text: 'Nudge' }, { id: 'snooze', text: 'Snooze 1h' }],
  morning: [{ id: 'openMorning', text: 'Open brief' }],
};
