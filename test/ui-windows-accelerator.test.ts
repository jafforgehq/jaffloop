import { describe, expect, it } from 'vitest';
import { keyName, recordAccelerator } from '../src/renderer/windows/accelerator';

const ev = (code: string, m: Partial<Record<'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey', boolean>> = {}) =>
  ({ code, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...m });

describe('recordAccelerator', () => {
  it('Alt+Space', () => expect(recordAccelerator(ev('Space', { altKey: true }))).toEqual({ kind: 'ok', accelerator: 'Alt+Space' }));
  it('uses the physical key, not the typed character (Option+K types a symbol on macOS)', () =>
    expect(recordAccelerator(ev('KeyK', { metaKey: true, shiftKey: true }))).toEqual({ kind: 'ok', accelerator: 'CommandOrControl+Shift+K' }));
  it('orders modifiers', () =>
    expect(recordAccelerator(ev('Digit1', { shiftKey: true, ctrlKey: true, altKey: true, metaKey: true }))).toEqual({ kind: 'ok', accelerator: 'Control+Alt+CommandOrControl+Shift+1' }));
  it('function keys need no modifier', () => expect(recordAccelerator(ev('F5'))).toEqual({ kind: 'ok', accelerator: 'F5' }));
  it('plain letters and shift-only are refused', () => {
    expect(recordAccelerator(ev('KeyK')).kind).toBe('error');
    expect(recordAccelerator(ev('KeyK', { shiftKey: true })).kind).toBe('error');
  });
  it('modifier alone waits, plain Escape cancels', () => {
    expect(recordAccelerator(ev('AltLeft', { altKey: true }))).toEqual({ kind: 'wait' });
    expect(recordAccelerator(ev('MetaRight', { metaKey: true }))).toEqual({ kind: 'wait' });
    expect(recordAccelerator(ev('Escape'))).toEqual({ kind: 'cancel' });
  });
  it('unsupported key', () => expect(recordAccelerator(ev('IntlRo', { altKey: true })).kind).toBe('error'));
});

describe('keyName', () => {
  it('maps codes', () => {
    expect(keyName('KeyA')).toBe('A');
    expect(keyName('Numpad7')).toBe('7');
    expect(keyName('F24')).toBe('F24');
    expect(keyName('F25')).toBeNull();
    expect(keyName('ArrowUp')).toBe('Up');
    expect(keyName('Enter')).toBe('Return');
  });
});
