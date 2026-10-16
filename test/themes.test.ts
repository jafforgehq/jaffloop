// WCAG contrast proof for every theme (and the dark and light sets of Classic), plus the shape of the theme data.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEMES, type ThemeName } from '../src/shared/themes-meta';
import { DEFAULT_UI, sanitizeUi, themeSource } from '../src/main/ui-state';
import { ACCENT_SETS, accentFor, cssVars, resolveTokens, themeMode, THEME_TOKENS, type ThemeTokens } from '../src/renderer/themes';

type RGBA = [number, number, number, number];
function parse(c: string): RGBA {
  const hex = /^#([0-9a-f]{6})$/i.exec(c);
  if (hex) { const n = parseInt(hex[1]!, 16); return [n >> 16, (n >> 8) & 255, n & 255, 1]; }
  const m = /^rgba?\(([^)]+)\)$/.exec(c);
  if (!m) throw new Error(`cannot parse ${c}`);
  const p = m[1]!.split(',').map((x) => parseFloat(x));
  return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
}
const over = (fg: RGBA, bg: RGBA): RGBA => [0, 1, 2].map((i) => fg[i]! * fg[3] + bg[i]! * (1 - fg[3])).concat(1) as RGBA;
const lum = ([r, g, b]: RGBA) => { const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
export function ratio(fg: string, bg: string, under = '#000000'): number {
  const b = over(parse(bg), parse(under));
  const f = over(parse(fg), b);
  const [hi, lo] = [lum(f), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const sets: Array<{ name: string; id: ThemeName; dark: boolean; t: ThemeTokens }> = [];
for (const m of THEMES) {
  for (const dark of m.mode === 'system' ? [true, false] : [m.mode === 'dark']) sets.push({ name: `${m.id}-${dark ? 'dark' : 'light'}`, id: m.id, dark, t: resolveTokens(m.id, dark) });
}

describe('theme data', () => {
  it('has a token set for every theme id and mode', () => {
    for (const m of THEMES) {
      const e = THEME_TOKENS[m.id];
      expect(e, m.id).toBeTruthy();
      if (m.mode === 'system') expect(e.dark && e.light).toBeTruthy();
      else expect(e[m.mode], m.id).toBeTruthy();
      expect(themeMode(m.id, true)).toBe(m.mode === 'system' ? 'dark' : m.mode);
      expect(themeMode(m.id, false)).toBe(m.mode === 'system' ? 'light' : m.mode);
    }
  });
  it('writes every variable styles.css uses', () => {
    const vars = Object.keys(cssVars('classic', true));
    for (const v of ['--bg', '--surface', '--elevated', '--text', '--text2', '--hairline', '--hover', '--selected', '--clay', '--avatar', '--accent', '--shadow', '--scrim', '--sidebar-bg',
      '--k-owe', '--k-wait', '--k-bring', '--k-task', '--k-said', '--k-note', '--on-clay']) expect(vars).toContain(v);
  });
  it('keeps the styles.css fallback equal to Classic', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
    const dark = /:root \{([^}]*)\}/.exec(css)![1]!;
    const light = /@media \(prefers-color-scheme: light\) \{\s*:root \{([^}]*)\}/.exec(css)![1]!;
    for (const [block, dk] of [[dark, true], [light, false]] as const) {
      for (const [k, v] of Object.entries(cssVars('classic', dk))) {
        if (k === '--accent') continue;
        const m = new RegExp(`${k}:\\s*([^;]+);`).exec(block);
        expect(m?.[1], `${k} (${dk ? 'dark' : 'light'})`).toBe(v);
      }
    }
  });
});

describe.each(sets)('contrast: $name', ({ t }) => {
  const hc = t.bg === '#000000';
  const grounds = { bg: t.bg, surface: t.surface, elevated: t.elevated };
  it.each(Object.entries(grounds))('text >= 7:1 on %s', (_n, g) => { expect(ratio(t.text, g)).toBeGreaterThanOrEqual(7); });
  it.each(Object.entries(grounds))('text2 >= 6:1 (7:1 for High contrast) on %s', (_n, g) => { expect(ratio(t.text2, g)).toBeGreaterThanOrEqual(hc ? 7 : 6); });
  it('text2 on the translucent sidebar (over bg) >= 6:1', () => { expect(ratio(t.text2, t.sidebarBg, t.bg)).toBeGreaterThanOrEqual(hc ? 7 : 6); });
  it.each(['owe', 'wait', 'bring', 'task', 'said', 'note', 'clay', 'accent'] as const)('%s >= 4.5:1 on bg, surface and elevated', (k) => {
    for (const g of Object.values(grounds)) expect(ratio(t[k], g), `${k} on ${g}`).toBeGreaterThanOrEqual(4.5);
  });
  it('text on a clay badge >= 4.5:1', () => { expect(ratio(t.onClay, t.clay)).toBeGreaterThanOrEqual(4.5); });
  it('hairline is visible on bg and elevated', () => {
    for (const g of [t.bg, t.elevated]) expect(ratio(t.hairline, g, g)).toBeGreaterThanOrEqual(hc ? 3 : 1.3);
  });
  it('surfaces are distinguishable and selection shows', () => {
    expect(ratio(t.elevated, t.bg)).toBeGreaterThan(1.05);
    expect(ratio(t.selected, t.bg, t.bg)).toBeGreaterThan(1.1);
  });
  it('the accent choices keep 4.5:1 on bg, surface and elevated', () => {
    for (const choice of ['blue', 'green', 'violet', 'amber'] as const) {
      const id = sets.find((s) => s.t === t)!;
      const a = accentFor(id.id, choice, id.dark);
      for (const g of Object.values(grounds)) expect(ratio(a, g), `${choice} on ${g}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('themes are distinct', () => {
  it('no two themes share a background', () => {
    const bgs = sets.map((s) => s.t.bg);
    expect(new Set(bgs).size).toBe(bgs.length);
  });
  it('accent sets are complete', () => { for (const s of Object.values(ACCENT_SETS)) expect(Object.keys(s).sort()).toEqual(['amber', 'blue', 'green', 'violet']); });
});

describe('ui-state', () => {
  it('defaults to Classic and only accepts known theme ids', () => {
    expect(DEFAULT_UI.theme).toBe('classic');
    for (const t of THEMES) expect(sanitizeUi({ theme: t.id })).toEqual({ theme: t.id });
    expect(sanitizeUi({ theme: 'neon' })).toEqual({});
    expect(sanitizeUi({ theme: 3 })).toEqual({});
  });
  it('picks the native theme source from the theme, Classic from the saved appearance', () => {
    expect(themeSource({ theme: 'classic', appearance: 'light' })).toBe('light');
    expect(themeSource({ theme: 'classic', appearance: 'system' })).toBe('system');
    expect(themeSource({ theme: 'midnight', appearance: 'light' })).toBe('dark');
    expect(themeSource({ theme: 'paper', appearance: 'dark' })).toBe('light');
    expect(themeSource({ theme: 'contrast', appearance: 'system' })).toBe('dark');
  });
});
