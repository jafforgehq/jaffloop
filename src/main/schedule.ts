// Scheduled sweeps as launchd jobs in ~/Library/LaunchAgents. The plist is the source of truth (see shared/schedule.ts).
// All side effects (fs, plutil, launchctl) come in through ScheduleDeps so tests never touch the real system.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROMPTS, renderPrompt, type JaffloopPrompt } from '../shared/prompts';
import { buildPlist, parsePlistJson, scheduleLabel, sweepCommand } from '../shared/schedule';
import type { Schedule } from '../shared/types';

export interface ScheduleFs {
  mkdirSync(dir: string, o: { recursive: true }): unknown;
  writeFileSync(file: string, data: string): void;
  readdirSync(dir: string): string[];
  unlinkSync(file: string): void;
  existsSync(file: string): boolean;
}
export interface ExecResult { code: number; stdout: string; stderr: string }

export interface ScheduleDeps {
  platform: string;
  /** ~/Library/LaunchAgents */
  agentsDir: string;
  /** ~/Library/Logs/Jaffloop */
  logsDir: string;
  uid: number;
  fs: ScheduleFs;
  exec(cmd: string, args: string[]): Promise<ExecResult>;
  /** a built-in schedulable prompt or an APPROVED custom prompt; null otherwise */
  findPrompt(id: string): JaffloopPrompt | null;
}

export interface ScheduleService {
  list(): Promise<Schedule[]>;
  save(s: Omit<Schedule, 'logPath'>): Promise<{ schedule?: Schedule; error?: string }>;
  remove(promptId: string): Promise<void>;
}

const MAC_ONLY = 'Scheduling is only available on macOS.';
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PREFIX = scheduleLabel('');

export function defaultScheduleDeps(findPrompt: (id: string) => JaffloopPrompt | null): ScheduleDeps {
  const home = os.homedir();
  return {
    platform: process.platform,
    agentsDir: path.join(home, 'Library', 'LaunchAgents'),
    logsDir: path.join(home, 'Library', 'Logs', 'Jaffloop'),
    uid: process.getuid?.() ?? 0,
    fs,
    exec: (cmd, args) => new Promise((resolve) => {
      execFile(cmd, args, { timeout: 15_000 }, (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      });
    }),
    findPrompt,
  };
}

/** Built-ins that are marked schedulable plus approved custom prompts (the caller passes only approved ones). */
export const builtinSchedulable = (id: string): JaffloopPrompt | null => PROMPTS.find((p) => p.id === id && p.schedulable) ?? null;

export function createScheduleService(d: ScheduleDeps): ScheduleService {
  const file = (promptId: string): string => path.join(d.agentsDir, `${scheduleLabel(promptId)}.plist`);
  const target = (promptId: string): string => `gui/${d.uid}/${scheduleLabel(promptId)}`;

  return {
    async list() {
      if (d.platform !== 'darwin') return [];
      let names: string[];
      try { names = d.fs.readdirSync(d.agentsDir); } catch { return []; }
      const out: Schedule[] = [];
      for (const n of names.filter((x) => x.startsWith(PREFIX) && x.endsWith('.plist')).sort()) {
        const r = await d.exec('plutil', ['-convert', 'json', '-o', '-', path.join(d.agentsDir, n)]);
        if (r.code !== 0) continue;
        try {
          const s = parsePlistJson(JSON.parse(r.stdout));
          if (s) out.push(s);
        } catch { /* not ours or damaged: skip */ }
      }
      return out;
    },

    async save(s) {
      if (d.platform !== 'darwin') return { error: MAC_ONLY };
      const int = (v: unknown, lo: number, hi: number): boolean => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
      if (typeof s.promptId !== 'string' || !ID.test(s.promptId)) return { error: 'Unknown prompt.' };
      if (!int(s.hour, 0, 23)) return { error: 'The hour must be 0 to 23.' };
      if (!int(s.minute, 0, 59)) return { error: 'The minute must be 0 to 59.' };
      if (!Array.isArray(s.weekdays) || !s.weekdays.every((w) => int(w, 0, 6))) return { error: 'Weekdays must be 0 (Sunday) to 6 (Saturday).' };
      const p = d.findPrompt(s.promptId);
      if (!p) return { error: 'This prompt cannot run on a schedule: it is not a schedulable built-in prompt or an approved custom prompt.' };
      const args = Object.fromEntries(Object.entries(s.args ?? {}).filter(([, v]) => typeof v === 'string' && v.trim() !== '').map(([k, v]) => [k, v.trim()]));
      const missing = p.arguments.filter((a) => a.required && !args[a.name]).map((a) => a.name);
      if (missing.length) return { error: `Fill in: ${missing.join(', ')}.` };

      const weekdays = [...new Set(s.weekdays)].sort((a, b) => a - b);
      const extra = typeof s.extraAllowedTools === 'string' ? s.extraAllowedTools.trim() : '';
      const logPath = path.join(d.logsDir, `sweep-${s.promptId}.log`);
      const schedule: Schedule = { promptId: s.promptId, args, hour: s.hour, minute: s.minute, weekdays, extraAllowedTools: extra, logPath };
      const plist = file(s.promptId);
      try {
        d.fs.mkdirSync(d.logsDir, { recursive: true });
        d.fs.mkdirSync(d.agentsDir, { recursive: true });
        d.fs.writeFileSync(plist, buildPlist({ ...schedule, command: sweepCommand(renderPrompt(p, args), extra) }));
      } catch (e) { return { error: `Could not write the schedule: ${(e as Error).message}` }; }

      await d.exec('launchctl', ['bootout', target(s.promptId)]); // not loaded yet is fine
      const r = await d.exec('launchctl', ['bootstrap', `gui/${d.uid}`, plist]);
      if (r.code !== 0) {
        try { d.fs.unlinkSync(plist); } catch { /* ignore */ }
        return { error: `launchctl could not load the schedule: ${(r.stderr || r.stdout).trim() || `exit ${r.code}`}` };
      }
      return { schedule };
    },

    async remove(promptId) {
      if (d.platform !== 'darwin' || !ID.test(promptId)) return;
      await d.exec('launchctl', ['bootout', target(promptId)]);
      try { if (d.fs.existsSync(file(promptId))) d.fs.unlinkSync(file(promptId)); } catch { /* ignore */ }
    },
  };
}
