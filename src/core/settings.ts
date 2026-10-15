// Settings defaults and conversions (pure).
import type { Settings } from '../shared/types';

export const DEFAULT_SETTINGS: Settings = {
  eodTime: '17:30', workStart: '09:00', workEnd: '18:00', morningBrief: '08:30',
  staleDaysAfterDue: 3, staleDaysNoDue: 5,
  mcpReadOnly: false, compact: false, sound: false, haptics: true,
  hotkey: 'Alt+Space',
  jiraBaseUrl: '', captureTemplates: [],
};

/** "17:30" -> [17, 30] */
export function hm(s: string): [number, number] {
  const p = s.split(':').map((x) => (/^[+-]?\d+$/.test(x) ? parseInt(x, 10) : null)).filter((x): x is number => x !== null);
  return [p[0] ?? 0, p[1] ?? 0];
}

const MODS: Record<string, string> = { opt: 'Alt', cmd: 'Command', ctrl: 'Control', shift: 'Shift' };
const KEYS: Record<string, string> = { space: 'Space', return: 'Return', tab: 'Tab' };

/** The Swift app stored "opt+space"; Electron wants "Alt+Space". Anything that is not all lowercase is already an accelerator. */
export function hotkeyToAccelerator(s: string): string {
  if (s === '' || s !== s.toLowerCase()) return s;
  return s.split('+').map((p) => MODS[p] ?? KEYS[p] ?? p.toUpperCase()).join('+');
}
