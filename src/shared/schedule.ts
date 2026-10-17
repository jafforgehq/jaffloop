// Scheduled sweeps: the shell command and the launchd plist. Pure (no fs, no electron) so the renderer can show the exact command.
import type { Schedule } from './types';

const PATTERN = /^[A-Za-z0-9_*.:][A-Za-z0-9_*.:-]*$/; // no leading '-': it would read as a claude option
const sq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** One shell line that runs the prompt headless with only the Jaffloop tools plus the extra connector patterns allowed. */
export function sweepCommand(promptText: string, extraAllowedTools = ''): string {
  const extra = extraAllowedTools.split(/[\s,]+/).filter((p) => PATTERN.test(p));
  return ['claude', '-p', sq(promptText), '--allowedTools', sq('mcp__jaffloop__*'), ...extra.map(sq)].join(' ');
}

export const scheduleLabel = (promptId: string): string => `com.jafforge.jaffloop.sweep.${promptId}`;

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** launchd job. The custom key JaffloopSchedule carries the settings so the file is the source of truth. */
export function buildPlist(s: Schedule & { command: string }): string {
  const day = (w: number | null): string =>
    `    <dict>${w === null ? '' : `<key>Weekday</key><integer>${w}</integer>`}<key>Hour</key><integer>${s.hour}</integer><key>Minute</key><integer>${s.minute}</integer></dict>`;
  const days = [...new Set(s.weekdays)].sort((a, b) => a - b);
  const everyDay = days.length === 0 || days.length === 7;
  const intervals = everyDay ? [day(null)] : days.map(day);
  const meta = JSON.stringify({ promptId: s.promptId, args: s.args, hour: s.hour, minute: s.minute, weekdays: s.weekdays, extraAllowedTools: s.extraAllowedTools });
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${esc(scheduleLabel(s.promptId))}</string>
  <key>ProgramArguments</key>
  <array><string>/bin/zsh</string><string>-lc</string><string>${esc(s.command)}</string></array>
  <key>StartCalendarInterval</key>
  <array>
${intervals.join('\n')}
  </array>
  <key>StandardOutPath</key><string>${esc(s.logPath)}</string>
  <key>StandardErrorPath</key><string>${esc(s.logPath)}</string>
  <key>RunAtLoad</key><false/>
  <key>JaffloopSchedule</key><string>${esc(meta)}</string>
</dict>
</plist>
`;
}

/** `plutil -convert json` output of one of our plists back to a Schedule; null when it is not ours or damaged. */
export function parsePlistJson(json: unknown): Schedule | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  if (typeof o.JaffloopSchedule !== 'string') return null;
  let m: Record<string, unknown>;
  try { m = JSON.parse(o.JaffloopSchedule) as Record<string, unknown>; } catch { return null; }
  const int = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
  if (typeof m.promptId !== 'string' || !m.promptId || !int(m.hour, 0, 23) || !int(m.minute, 0, 59)) return null;
  if (!Array.isArray(m.weekdays) || !m.weekdays.every((d) => int(d, 0, 6))) return null;
  const args: Record<string, string> = {};
  if (m.args && typeof m.args === 'object') for (const [k, v] of Object.entries(m.args)) if (typeof v === 'string') args[k] = v;
  return {
    promptId: m.promptId, args, hour: m.hour, minute: m.minute, weekdays: m.weekdays as number[],
    extraAllowedTools: typeof m.extraAllowedTools === 'string' ? m.extraAllowedTools : '',
    logPath: typeof o.StandardOutPath === 'string' ? o.StandardOutPath : '',
  };
}
