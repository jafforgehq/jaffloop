// KeyboardEvent -> Electron accelerator for the hotkey recorder (pure, so it is unit tested).

export interface KeyLike { code: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean }
export type Recorded =
  | { kind: 'wait' }                    // only a modifier is down so far
  | { kind: 'cancel' }                  // plain Escape
  | { kind: 'error'; message: string }
  | { kind: 'ok'; accelerator: string };

export const DEFAULT_HOTKEY = 'Alt+Space';

const NAMED: Record<string, string> = {
  Space: 'Space', Enter: 'Return', NumpadEnter: 'Return', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
};

/** The accelerator key name for a KeyboardEvent.code ("KeyK" -> "K", "F5" -> "F5"), or null when unsupported. */
export function keyName(code: string): string | null {
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1]!;
  m = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (m) return m[1]!;
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  return NAMED[code] ?? null;
}

const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/;

/** Needs Ctrl, Alt or Cmd unless it is a function key. */
export function recordAccelerator(e: KeyLike): Recorded {
  if (MODIFIER_CODES.test(e.code)) return { kind: 'wait' };
  const main = e.ctrlKey || e.altKey || e.metaKey;
  if (e.code === 'Escape' && !main && !e.shiftKey) return { kind: 'cancel' };
  const key = keyName(e.code);
  if (!key) return { kind: 'error', message: 'That key is not supported.' };
  if (!main && !/^F\d+$/.test(key)) return { kind: 'error', message: 'Add Ctrl, Alt or Cmd.' };
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Control');
  if (e.altKey) parts.push('Alt');
  if (e.metaKey) parts.push('CommandOrControl');
  if (e.shiftKey) parts.push('Shift');
  return { kind: 'ok', accelerator: [...parts, key].join('+') };
}
