// 0.5.0 ipc handlers: custom prompts, sync health, schedules. electron is stubbed; the store is real (in memory), the schedule service a fake.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getVersion: () => 'x', isPackaged: false }, BrowserWindow: { fromWebContents: () => null }, clipboard: {}, dialog: {}, ipcMain: {}, shell: {} }));

import { Store, openMemoryDatabase } from '../src/core';
import { createHandlers, type IpcCtx } from '../src/main/ipc';
import type { ScheduleService } from '../src/main/schedule';
import type { Schedule } from '../src/shared/types';

const input = { id: 'my-sweep', title: 'My sweep', description: '', needs: [], arguments: [], text: 'Read my Teams chats and add promises I made.' };
const sch: Omit<Schedule, 'logPath'> = { promptId: 'monday-sweep', args: {}, hour: 8, minute: 0, weekdays: [1], extraAllowedTools: '' };

let store: Store;
let changed: number;
let svc: ScheduleService;
let calls: string[];
let h: ReturnType<typeof createHandlers>;
const e = {} as never;

beforeEach(() => {
  store = new Store(openMemoryDatabase());
  changed = 0;
  calls = [];
  svc = {
    list: async () => [{ ...sch, logPath: '/l' }],
    save: async (s) => { calls.push(`save:${s.promptId}`); return { schedule: { ...s, logPath: '/l' } }; },
    remove: async (id) => { calls.push(`remove:${id}`); },
  };
  h = createHandlers({ store, changed: () => { changed++; }, schedule: svc, mcp: { command: '', binary: '' } } as unknown as IpcCtx);
});

describe('ipc: custom prompts and schedules', () => {
  it('saveCustomPrompt saves approved from the app and broadcasts; an invalid one does not', async () => {
    const r = await h.saveCustomPrompt(e, input);
    expect(r.prompt?.approved).toBe(true);
    expect(changed).toBe(1);
    expect((await h.saveCustomPrompt(e, { ...input, id: 'monday-sweep' })).error).toBeTruthy();
    expect(changed).toBe(1);
    expect((await h.customPrompts(e)).map((p) => p.id)).toEqual(['my-sweep']);
  });
  it('approve and delete broadcast; delete also removes the prompt\'s schedule', async () => {
    store.saveCustomPrompt(input, 'mcp', Date.now());
    expect((await h.customPrompts(e))[0]!.approved).toBe(false);
    await h.approveCustomPrompt(e, 'my-sweep');
    expect((await h.customPrompts(e))[0]!.approved).toBe(true);
    await h.deleteCustomPrompt(e, 'my-sweep');
    expect(await h.customPrompts(e)).toEqual([]);
    expect(calls).toEqual(['remove:my-sweep']);
    expect(changed).toBe(2);
  });
  it('syncHealth reads the store', async () => {
    expect((await h.syncHealth(e)).sources).toEqual([]);
  });
  it('schedule handlers go to the schedule service', async () => {
    expect(await h.schedules(e)).toHaveLength(1);
    expect((await h.saveSchedule(e, sch)).schedule?.logPath).toBe('/l');
    await h.removeSchedule(e, 'monday-sweep');
    expect(calls).toEqual(['save:monday-sweep', 'remove:monday-sweep']);
  });
});
