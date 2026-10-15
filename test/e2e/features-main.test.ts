// 0.2.0 main-process features against the built app: new API methods, pause notifications, tray text, Dock badge.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { cleanup, launchApp, type Launched } from './helpers';

let l: Launched;
let w: Page;
const DAY = 86_400_000;
const api = <T>(method: string, ...args: unknown[]) => w.evaluate(([m, a]) => (window.jaffloop as unknown as Record<string, (...x: unknown[]) => unknown>)[m as string]!(...(a as unknown[])), [method, args]) as Promise<T>;
const hook = <T>(fn: (j: any) => T) => l.app.evaluate((_e, f) => (new Function('j', `return (${f})(j)`))((globalThis as any).__jaffloop), fn.toString());
const diskUi = () => JSON.parse(fs.readFileSync(path.join(l.userData, 'ui-state.json'), 'utf8')) as Record<string, unknown>;

beforeAll(async () => {
  l = await launchApp({ env: { JAFFLOOP_SNAPSHOT: '1' } });
  w = l.window;
  await w.evaluate(() => window.jaffloop.setUiState({ lastSeenVersion: '0.2.0', welcomeSeen: true }));
});
afterAll(async () => { await l.close(); cleanup(l); });

describe('new API methods', () => {
  it('review returns the weekly review shape', async () => {
    const now = Date.now();
    const r = await api<Record<string, unknown>>('review', now - 7 * DAY);
    for (const k of ['slipped', 'staleWaits', 'overduePromises', 'offCadence', 'closed', 'dropped', 'created']) expect(Array.isArray(r[k])).toBe(true);
    expect(r.from).toBe(now - 7 * DAY);
    expect(r.to).toBeGreaterThanOrEqual(now);
    expect(r.keptRate).toMatchObject({ periodDays: expect.any(Number), onTime: expect.any(Number), late: expect.any(Number), total: expect.any(Number) });
    expect((r.overduePromises as Array<{ kind: string }>).every((i) => i.kind === 'owe')).toBe(true);
  });

  it('keptRate, activity, heatGrid, onTimeStreak and upcomingDates answer with their shapes', async () => {
    const k = await api<{ periodDays: number; total: number; rate: number | null }>('keptRate', 30);
    expect(k.periodDays).toBe(30);
    expect(k.rate === null ? k.total === 0 : k.rate >= 0 && k.rate <= 1).toBe(true);

    const act = await api<Array<{ at: number; event: string; item: { id: string } }>>('activity', Date.now() - 30 * DAY, 10);
    expect(act.length).toBeLessThanOrEqual(10);
    expect(act.every((e, i) => typeof e.event === 'string' && e.item.id && (i === 0 || act[i - 1]!.at >= e.at))).toBe(true);

    const heat = await api<Array<{ personId: string; weeks: boolean[] }>>('heatGrid', 6);
    expect(heat.length).toBeGreaterThan(0);
    expect(heat.every((h) => h.weeks.length === 6 && h.weeks.every((x) => typeof x === 'boolean'))).toBe(true);

    expect(await api<number>('onTimeStreak', heat[0]!.personId)).toBeGreaterThanOrEqual(0);

    const dates = await api<Array<{ kind: string; inDays: number }>>('upcomingDates', 14);
    expect(Array.isArray(dates)).toBe(true);
  });

  it('a person start date and birthday show up in upcomingDates, anniversary with the years', async () => {
    const snap = await api<{ summaries: Array<{ person: { id: string; handle: string } & Record<string, unknown> }> }>('snapshot');
    const p = snap.summaries.find((s) => s.person.handle === 'sara')!.person;
    const d = new Date(Date.now() + 3 * DAY);
    const mmdd = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await api('savePerson', { ...p, startDate: `${d.getFullYear() - 2}-${mmdd}`, birthday: null });
    const dates = await api<Array<{ personId: string; kind: string; inDays: number; years: number | null }>>('upcomingDates', 14);
    expect(dates.find((u) => u.personId === p.id && u.kind === 'anniversary')).toMatchObject({ years: 2 });
  });

  it('captureMany saves one item for a plain line and the template lines for a template', async () => {
    const one = await api<Array<{ title: string; kind: string }>>('captureMany', 'owe @amir plain line from captureMany');
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ kind: 'owe', title: 'plain line from captureMany' });

    const s = await api<{ captureTemplates: unknown[] }>('saveSettings', { captureTemplates: [{ name: 'prep', lines: ['bring @{person} how are things', 'bring @{person} career goals'] }] });
    expect(s.captureTemplates).toHaveLength(1);
    const many = await api<Array<{ title: string; kind: string; personId: string | null }>>('captureMany', 'prep @amir');
    expect(many).toHaveLength(2);
    expect(many.every((i) => i.kind === 'bring' && i.personId)).toBe(true);

    // the capture panel path (captureSubmit) expands templates too
    await w.evaluate(() => window.jaffloop.openCapture());
    const cap = await l.waitView('capture');
    await cap.evaluate(() => window.jaffloop.captureSubmit('prep @maya', false));
    await expect.poll(async () => (await api<Array<{ title: string }>>('search', 'career goals')).length).toBeGreaterThanOrEqual(2);
  });
});

describe('pause notifications', () => {
  it('stores pauseUntil on disk, holds back every notification, and clears on null', async () => {
    const until = Date.now() + 60 * DAY; // beyond everything the plan looks at
    await api('pauseNotifications', until);
    expect((await api<{ pauseUntil: number | null }>('uiState')).pauseUntil).toBe(until);
    expect(diskUi().pauseUntil).toBe(until);
    await hook((j) => j.notifier.rebuild());
    expect(await hook((j) => j.notifier.scheduled())).toEqual([]);

    await api('pauseNotifications', null);
    expect((await api<{ pauseUntil: number | null }>('uiState')).pauseUntil).toBeNull();
    expect(diskUi().pauseUntil).toBeNull();
    await hook((j) => j.notifier.rebuild());
    expect((await hook((j) => j.notifier.scheduled())).length).toBeGreaterThan(0);
  });

  it('ignores a pause in the past', async () => {
    await api('pauseNotifications', Date.now() - 1000);
    expect((await api<{ pauseUntil: number | null }>('uiState')).pauseUntil).toBeNull();
  });

  it('a pause that ends soon clears itself and notifications resume', async () => {
    const until = Date.now() + 1500;
    await api('pauseNotifications', until);
    await hook((j) => j.notifier.rebuild());
    expect((await hook((j) => j.notifier.scheduled())).every((x: { at: number }) => x.at >= until)).toBe(true);
    await expect.poll(async () => (await api<{ pauseUntil: number | null }>('uiState')).pauseUntil, { timeout: 8000 }).toBeNull();
    await expect.poll(() => hook((j) => j.notifier.scheduled().length), { timeout: 8000 }).toBeGreaterThan(0);
  });

  it('survives a restart while running, and an expired pause is cleared on startup', async () => {
    const until = Date.now() + 30 * DAY;
    await api('pauseNotifications', until);
    await l.close();
    l = await launchApp({ dir: l.dir, seed: false, env: { JAFFLOOP_SNAPSHOT: '1' } });
    w = l.window;
    expect((await api<{ pauseUntil: number | null }>('uiState')).pauseUntil).toBe(until);
    await l.close();
    const file = path.join(l.userData, 'ui-state.json');
    fs.writeFileSync(file, JSON.stringify({ ...diskUi(), pauseUntil: Date.now() - 60_000 }));
    l = await launchApp({ dir: l.dir, seed: false, env: { JAFFLOOP_SNAPSHOT: '1' } });
    w = l.window;
    expect((await api<{ pauseUntil: number | null }>('uiState')).pauseUntil).toBeNull();
    expect(diskUi().pauseUntil).toBeNull();
  });
});

describe('menu bar text and Dock badge', () => {
  it('shows the count by default and the Dock badge matches it', async () => {
    const t = await hook((j) => j.tray.state());
    expect(t.count).toBeGreaterThan(0);
    expect(t.title).toBe(` ${t.count}`);
    expect(await hook((j) => j.badge)).toBe(String(t.count));
  });

  it("trayText 'next' shows the next due item, and goes back to the count", async () => {
    await api('setUiState', { trayText: 'next' });
    await expect.poll(async () => (await hook((j) => j.tray.state())).title).toMatch(/^ \S+ \S+ · .+/);
    const t = await hook((j) => j.tray.state());
    expect(t.title.trim().length).toBeLessThanOrEqual(24);
    expect(t.title.startsWith(' wait Amir · ')).toBe(true); // the oldest overdue item in the demo data
    expect(await hook((j) => j.badge)).toBe(String(t.count)); // the badge keeps the count

    await api('setUiState', { trayText: 'count' });
    await expect.poll(async () => (await hook((j) => j.tray.state())).title).toBe(` ${t.count}`);
  });

  it('clears the Dock badge when nothing is overdue or slipping', async () => {
    await api('setUiState', { trayText: 'next' });
    // drop everything overdue or slipping
    const items = await api<Array<{ id: string; dueAt: number | null; dueHasTime: boolean; snoozeCount: number }>>('items', { status: 'open' });
    const now = Date.now();
    for (const i of items) if ((i.dueAt !== null && (i.dueHasTime ? i.dueAt < now : i.dueAt < new Date().setHours(0, 0, 0, 0))) || i.snoozeCount >= 3) await api('drop', i.id);
    await expect.poll(() => hook((j) => j.badge)).toBe('');
    expect((await hook((j) => j.tray.state())).count).toBe(0);
    // text falls back to the next due item (still dated), or to nothing
    const title: string = (await hook((j) => j.tray.state())).title;
    expect(title === '' || /^ \S+ .+/.test(title)).toBe(true);
  });
});
