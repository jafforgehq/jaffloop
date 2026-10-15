// Demo data for screenshots and end-to-end tests (JAFFLOOP_SEED=1). Port of Screenshots.seed in the Swift app.
import type { ItemKind, Person, Relation } from '../shared/types';
import { addDays, atTime, startOfDay } from './calendar';
import { newItem, newPerson } from './models';
import type { Store } from './store';

export function seed(store: Store, now: number = Date.now()): void {
  const today = startOfDay(now);
  const day = (off: number, hour?: number, minute = 0): number => (hour === undefined ? addDays(today, off) : atTime(addDays(today, off), hour, minute));
  const todayAt = (h: number): number => day(0, Math.min(23, Math.max(h, new Date(now).getHours() + 1)));
  const ago = (days: number): number => addDays(now, -days);

  const person = (handle: string, name: string, relation: Relation, cadenceDays: number | null, last: number | null, matchEmails = ''): Person => {
    const p = newPerson({ handle, name, relation, cadenceDays, matchEmails });
    store.savePerson(p);
    if (last !== null) store.logInteraction(p.id, '1on1', null, ago(last));
    return p;
  };
  const sara = person('sara', 'Sara Lindqvist', 'report', 14, 23, 'sara@example.com');
  const amir = person('amir', 'Amir Haddad', 'report', 7, 5, 'amir@example.com');
  const maya = person('maya', 'Maya Chen', 'peer', null, 12);
  const jonas = person('jonas', 'Jonas Weber', 'stakeholder', 30, 9);
  person('priya', 'Priya Nair', 'report', 14, 6);

  interface Opts { due?: number | null; time?: boolean; created?: number; snoozes?: number; pinned?: boolean; quote?: string; inbox?: boolean; tags?: string[] }
  const add = (kind: ItemKind, title: string, p: Person | null = null, o: Opts = {}): void => {
    const created = ago(o.created ?? 1);
    store.insert(newItem({
      kind, title, quote: o.quote ?? null, personId: p?.id ?? null, dueAt: o.due ?? null, dueHasTime: o.time ?? false,
      snoozeCount: o.snoozes ?? 0, pinned: o.pinned ?? false, inbox: o.inbox ?? false, source: 'hotkey', now: created,
    }), o.tags ?? []);
  };

  add('owe', 'Review RFC for the on-call rotation', sara, { due: day(-2), created: 6, tags: ['rfc'] });
  add('owe', 'Send promotion timeline draft', sara, { due: day(2), created: 3 });
  add('owe', 'Approve headcount request', amir, { due: day(0), created: 4 });
  add('owe', 'Intro to the platform team lead', maya, { due: day(5), created: 2 });
  add('owe', 'Share Q4 roadmap outline', jonas, { due: todayAt(16), time: true, created: 2 });
  add('task', 'Prepare Q4 plan', null, { due: day(1), created: 5, snoozes: 3, tags: ['planning'] });
  add('task', '1:1 prep', null, { due: todayAt(9), time: true, created: 7, pinned: true });
  add('wait', 'API spec for the billing service', amir, { due: day(-5), created: 10 });
  add('wait', 'Incident review notes', maya, { due: day(-1), created: 4 });
  add('wait', 'Vendor quote for monitoring', jonas, { created: 9 });
  add('bring', 'Workload and the on-call rotation', sara, { created: 5 });
  add('bring', 'Promotion timeline', sara, { created: 5 });
  add('bring', 'Conference talk proposal', amir, { created: 3 });
  add('task', 'Call the vendor about the invoice', null, { created: 0, inbox: true });
  add('task', 'Buy a USB-C cable', null, { created: 0, inbox: true });
  add('said', 'Headcount revisit', sara, { created: 12, quote: "We'll revisit headcount in November" });
  add('said', 'Ship date', amir, { created: 4, quote: 'Ship date is firm for Nov 20' });
  add('note', 'Sara prefers async updates', sara, { created: 20 });

  // finished, dropped and snoozed items for the Done and Snoozed views
  store.complete(store.capture('owe @amir send the onboarding doc fri', 'hotkey', now).id, now);
  store.complete(store.capture('wait @maya security review sign-off', 'hotkey', now).id, now);
  store.drop(store.capture('todo renew the monitoring contract', 'hotkey', now).id, now);
  store.snooze(store.capture('bring @sara conference budget', 'hotkey', now).id, now + 3 * 86_400_000, now);
  store.snooze(store.capture('owe @jonas security audit summary', 'hotkey', now).id, now + 26 * 3_600_000, now);
  store.savePerson({ ...sara, notes: 'Prefers async updates. Wants a staff promotion case ready for the Q1 cycle.' });
}
