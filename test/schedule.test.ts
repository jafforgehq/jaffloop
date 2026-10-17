import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { builtinSchedulable, createScheduleService, type ExecResult, type ScheduleDeps } from '../src/main/schedule';
import { PROMPTS } from '../src/shared/prompts';
import { buildPlist, parsePlistJson, scheduleLabel, sweepCommand } from '../src/shared/schedule';
import type { Schedule } from '../src/shared/types';

const sched: Schedule = { promptId: 'monday-sweep', args: { since: 'last Monday' }, hour: 8, minute: 30, weekdays: [1, 2, 3, 4, 5], extraAllowedTools: 'mcp__outlook__*', logPath: '/logs/sweep-monday-sweep.log' };

describe('sweepCommand', () => {
  it('quotes the prompt and the tools', () => {
    expect(sweepCommand('Read it')).toBe("claude -p 'Read it' --allowedTools 'mcp__jaffloop__*'");
    expect(sweepCommand("it's here")).toBe(`claude -p 'it'\\''s here' --allowedTools 'mcp__jaffloop__*'`);
  });
  it('splits extra patterns on spaces and commas and drops unsafe ones', () => {
    expect(sweepCommand('x', 'mcp__a__*, mcp__b__* ;rm -rf $(x) mcp__c__tool')).toBe(
      "claude -p 'x' --allowedTools 'mcp__jaffloop__*' 'mcp__a__*' 'mcp__b__*' 'mcp__c__tool'",
    );
  });
});

describe('plist', () => {
  it('has label, command, one interval per weekday, log paths and metadata', () => {
    const x = buildPlist({ ...sched, command: `claude -p 'a & <b>'` });
    expect(x).toContain('<key>Label</key><string>com.jafforge.jaffloop.sweep.monday-sweep</string>');
    expect(x).toContain('<string>/bin/zsh</string><string>-lc</string><string>claude -p \'a &amp; &lt;b&gt;\'</string>');
    expect(x.match(/<key>Weekday<\/key>/g)).toHaveLength(5);
    expect(x).toContain('<key>Hour</key><integer>8</integer><key>Minute</key><integer>30</integer>');
    expect(x.match(/<string>\/logs\/sweep-monday-sweep\.log<\/string>/g)).toHaveLength(2);
    expect(x).toContain('<key>RunAtLoad</key><false/>');
    expect(x).toContain('<key>JaffloopSchedule</key>');
  });
  it('uses a single entry without Weekday when every day', () => {
    for (const weekdays of [[], [0, 1, 2, 3, 4, 5, 6]]) {
      const x = buildPlist({ ...sched, weekdays, command: 'c' });
      expect(x).not.toContain('Weekday');
      expect(x.match(/<key>Hour<\/key>/g)).toHaveLength(1);
    }
  });
  it('parsePlistJson round trips the metadata and rejects foreign or broken plists', () => {
    const meta = JSON.stringify({ promptId: 'monday-sweep', args: { since: 'last Monday' }, hour: 8, minute: 30, weekdays: [1, 2, 3, 4, 5], extraAllowedTools: 'mcp__outlook__*' });
    expect(parsePlistJson({ JaffloopSchedule: meta, StandardOutPath: '/logs/a.log' })).toEqual({ ...sched, logPath: '/logs/a.log' });
    expect(parsePlistJson(null)).toBeNull();
    expect(parsePlistJson({ Label: 'x' })).toBeNull();
    expect(parsePlistJson({ JaffloopSchedule: '{nope' })).toBeNull();
    expect(parsePlistJson({ JaffloopSchedule: JSON.stringify({ promptId: 'a', hour: 25, minute: 0, weekdays: [] }) })).toBeNull();
    expect(parsePlistJson({ JaffloopSchedule: JSON.stringify({ promptId: 'a', hour: 1, minute: 0, weekdays: [9] }) })).toBeNull();
  });
});

function fake(over: Partial<ScheduleDeps> = {}) {
  const files = new Map<string, string>();
  const calls: string[][] = [];
  let bootstrapCode = 0;
  const deps: ScheduleDeps = {
    platform: 'darwin', agentsDir: '/fake/LaunchAgents', logsDir: '/fake/Logs/Jaffloop', uid: 501,
    fs: {
      mkdirSync: () => undefined,
      writeFileSync: (f, d) => void files.set(f, d),
      readdirSync: () => [...files.keys()].map((f) => path.basename(f)).concat('other.plist'),
      unlinkSync: (f) => void files.delete(f),
      existsSync: (f) => files.has(f),
    },
    exec: async (cmd, args): Promise<ExecResult> => {
      calls.push([cmd, ...args]);
      if (cmd === 'plutil') {
        const xml = files.get(args[args.length - 1]!);
        if (!xml) return { code: 1, stdout: '', stderr: 'no such file' };
        // stand-in for plutil: lift the metadata and log path out of the plist text
        const meta = /<key>JaffloopSchedule<\/key><string>(.*)<\/string>/.exec(xml)![1]!.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        return { code: 0, stdout: JSON.stringify({ JaffloopSchedule: meta, StandardOutPath: /<key>StandardOutPath<\/key><string>(.*?)<\/string>/.exec(xml)![1] }), stderr: '' };
      }
      if (args[0] === 'bootstrap') return { code: bootstrapCode, stdout: '', stderr: bootstrapCode ? 'Bootstrap failed: 5' : '' };
      return { code: 3, stdout: '', stderr: 'not loaded' }; // bootout of an unloaded job fails
    },
    findPrompt: (id) => builtinSchedulable(id),
    ...over,
  };
  return { deps, files, calls, failBootstrap: () => { bootstrapCode = 5; } };
}
const { logPath: _l, ...input } = sched;

describe('schedule service', () => {
  it('saves: writes the plist, boots out then bootstraps, returns the schedule with the log path', async () => {
    const f = fake();
    const r = await createScheduleService(f.deps).save(input);
    expect(r.error).toBeUndefined();
    expect(r.schedule).toEqual({ ...sched, logPath: '/fake/Logs/Jaffloop/sweep-monday-sweep.log' });
    const label = scheduleLabel('monday-sweep');
    const plist = f.files.get(`/fake/LaunchAgents/${label}.plist`)!;
    expect(plist).toContain("claude -p 'Read my Outlook sent mail");
    expect(plist).toContain('last Monday');
    expect(plist).toContain("'mcp__outlook__*'");
    expect(f.calls).toEqual([['launchctl', 'bootout', `gui/501/${label}`], ['launchctl', 'bootstrap', 'gui/501', `/fake/LaunchAgents/${label}.plist`]]);
  });
  it('lists what it saved and ignores other plists', async () => {
    const f = fake();
    const svc = createScheduleService(f.deps);
    await svc.save(input);
    expect(await svc.list()).toEqual([{ ...sched, logPath: '/fake/Logs/Jaffloop/sweep-monday-sweep.log' }]);
  });
  it('rejects bad time, weekdays, unknown and non-schedulable prompts, missing required arguments', async () => {
    const f = fake({ findPrompt: (id) => (id === 'custom-req' ? { id, title: 't', description: '', needs: [], arguments: [{ name: 'who', description: '', required: true }], text: 'for {{who}} ' + 'x'.repeat(20) } : builtinSchedulable(id)) });
    const svc = createScheduleService(f.deps);
    expect((await svc.save({ ...input, hour: 24 })).error).toMatch(/hour/);
    expect((await svc.save({ ...input, minute: -1 })).error).toMatch(/minute/);
    expect((await svc.save({ ...input, hour: 1.5 })).error).toMatch(/hour/);
    expect((await svc.save({ ...input, weekdays: [7] })).error).toMatch(/Weekdays/);
    expect((await svc.save({ ...input, promptId: 'nope' })).error).toMatch(/cannot run/);
    expect((await svc.save({ ...input, promptId: '../../etc/x' })).error).toBeTruthy();
    const notSchedulable = PROMPTS.find((p) => !p.schedulable)!.id;
    expect((await svc.save({ ...input, promptId: notSchedulable })).error).toMatch(/cannot run/);
    expect((await svc.save({ ...input, promptId: 'custom-req', args: {} })).error).toMatch(/who/);
    expect((await svc.save({ ...input, promptId: 'custom-req', args: { who: 'sara' } })).error).toBeUndefined();
    expect(f.calls.every((c) => c[0] === 'launchctl')).toBe(true);
    expect(f.files.size).toBe(1);
  });
  it('removes the file again when launchctl cannot load it', async () => {
    const f = fake();
    f.failBootstrap();
    const r = await createScheduleService(f.deps).save(input);
    expect(r.error).toMatch(/Bootstrap failed/);
    expect(f.files.size).toBe(0);
  });
  it('reports a write failure as an error', async () => {
    const f = fake();
    f.deps.fs.writeFileSync = () => { throw new Error('disk full'); };
    expect((await createScheduleService(f.deps).save(input)).error).toMatch(/disk full/);
    expect(f.calls).toEqual([]);
  });
  it('remove boots out and deletes the file', async () => {
    const f = fake();
    const svc = createScheduleService(f.deps);
    await svc.save(input);
    f.calls.length = 0;
    await svc.remove('monday-sweep');
    expect(f.calls).toEqual([['launchctl', 'bootout', `gui/501/${scheduleLabel('monday-sweep')}`]]);
    expect(f.files.size).toBe(0);
  });
  it('is macOS only', async () => {
    const f = fake({ platform: 'linux' });
    const svc = createScheduleService(f.deps);
    expect((await svc.save(input)).error).toBe('Scheduling is only available on macOS.');
    expect(await svc.list()).toEqual([]);
    await svc.remove('monday-sweep');
    expect(f.calls).toEqual([]);
  });
});
