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

  const ymd = (ms: number, yearsBack = 0): string => {
    const d = new Date(ms);
    const p2 = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear() - yearsBack}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  };

  const person = (handle: string, name: string, relation: Relation, cadenceDays: number | null, last: number | null, matchEmails = '',
    dates: { startDate?: string; birthday?: string } = {}): Person => {
    const p = newPerson({ handle, name, relation, cadenceDays, matchEmails, ...dates });
    store.savePerson(p);
    if (last !== null) store.logInteraction(p.id, '1on1', null, ago(last));
    return p;
  };
  // a work anniversary in 3 days (2 years) and a birthday tomorrow, so the dates chips have something to show
  const sara = person('sara', 'Sara Lindqvist', 'report', 14, 23, 'sara@example.com', { startDate: ymd(day(3), 2) });
  const amir = person('amir', 'Amir Haddad', 'report', 7, 5, 'amir@example.com', { birthday: ymd(day(1)).slice(5) });
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
  add('owe', 'Review PLAT-482 rollout plan', jonas, { due: day(3), created: 1 });
  add('task', 'Read https://example.com/rfc-12 before Friday', null, { due: day(2), created: 1 });

  // promises kept over the last two weeks (six on time, one late) with their item_events: kept rate, review and activity have content
  const kept = (title: string, p: Person, createdAgo: number, due: number | null, doneAgo: number): void => {
    const item = newItem({ kind: 'owe', title, personId: p.id, dueAt: due, source: 'hotkey', now: ago(createdAgo) });
    store.insert(item, []);
    store.complete(item.id, ago(doneAgo));
  };
  kept('Send the interview feedback', sara, 12, day(-8), 9);
  kept('Book the offsite venue', maya, 10, day(-6), 7);
  kept('Share the team survey results', amir, 10, day(-5), 6);
  kept('Reply to the vendor security questionnaire', jonas, 9, day(-4), 4);
  kept('Write the promotion packet outline', sara, 8, day(-3), 5);
  kept('Approve the conference budget', maya, 6, null, 3);
  kept('Send the headcount numbers', jonas, 8, day(-6), 2);

  // finished, dropped and snoozed items for the Done and Snoozed views
  store.complete(store.capture('owe @amir send the onboarding doc fri', 'hotkey', now).id, now);
  store.complete(store.capture('wait @maya security review sign-off', 'hotkey', now).id, now);
  store.drop(store.capture('todo renew the monitoring contract', 'hotkey', now).id, now);
  store.snooze(store.capture('bring @sara conference budget', 'hotkey', now).id, now + 3 * 86_400_000, now);
  store.snooze(store.capture('owe @jonas security audit summary', 'hotkey', now).id, now + 26 * 3_600_000, now);
  store.saveSettings({
    ...store.settings(),
    jiraBaseUrl: 'https://acme.atlassian.net/browse/',
    captureTemplates: [
      { name: 'prep', lines: ['bring @{person} how things are going', 'bring @{person} career goals and growth', 'bring @{person} feedback for the team'] },
      { name: 'fu', lines: ['wait @{person} {rest}'] },
    ],
  });
  store.savePerson({ ...sara, notes: 'Prefers async updates. Wants a staff promotion case ready for the Q1 cycle.' });
}
