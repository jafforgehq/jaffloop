// Colour themes: pure data plus applyTheme (writes CSS variables on <html>). Ids, labels and modes live in src/shared/themes-meta.ts.
// Every set is checked by test/themes.test.ts (WCAG contrast); change a colour there first when in doubt.
// styles.css keeps the Classic values as the fallback before the first applyTheme call, test/themes.test.ts keeps them in sync.
import type { AccentChoice } from '../shared/api';
import { THEMES, type ThemeName } from '../shared/themes-meta';

export interface ThemeTokens {
  bg: string; surface: string; elevated: string; text: string; text2: string; hairline: string; hover: string; selected: string;
  clay: string; /** text on a clay-filled badge */ onClay: string; avatar: string;
  owe: string; wait: string; bring: string; task: string; said: string; note: string;
  accent: string; shadow: string; scrim: string; sidebarBg: string;
}

const classicDark: ThemeTokens = {
  bg: '#121211', surface: '#191918', elevated: '#232322', text: '#f2f0eb', text2: '#b3b0a8', hairline: 'rgba(255, 255, 255, 0.13)',
  hover: 'rgba(255, 255, 255, 0.06)', selected: 'rgba(255, 255, 255, 0.11)', clay: '#f2876c', onClay: '#1a0c08', avatar: '#34332f',
  owe: '#dbb77c', wait: '#90b2cb', bring: '#b6a8cd', task: '#aeaba3', said: '#9cc1a8', note: '#a3a099',
  accent: '#b3b0a8', shadow: 'rgba(0, 0, 0, 0.4)', scrim: 'rgba(0, 0, 0, 0.32)', sidebarBg: 'rgba(25, 25, 24, 0.7)',
};
const classicLight: ThemeTokens = {
  bg: '#f5f3ef', surface: '#fbfaf8', elevated: '#ffffff', text: '#171614', text2: '#55524b', hairline: 'rgba(0, 0, 0, 0.14)',
  hover: 'rgba(0, 0, 0, 0.045)', selected: 'rgba(0, 0, 0, 0.08)', clay: '#a93a1a', onClay: '#ffffff', avatar: '#e4e0d6',
  owe: '#7a5718', wait: '#3b5f80', bring: '#62507f', task: '#5c5a52', said: '#3e6a4c', note: '#66645b',
  accent: '#55524b', shadow: 'rgba(0, 0, 0, 0.18)', scrim: 'rgba(0, 0, 0, 0.2)', sidebarBg: 'rgba(251, 250, 248, 0.72)',
};

export const THEME_TOKENS: Record<ThemeName, { dark?: ThemeTokens; light?: ThemeTokens }> = {
  classic: { dark: classicDark, light: classicLight },
  graphite: {
    dark: {
      bg: '#161616', surface: '#1e1e1e', elevated: '#282828', text: '#f1f1f1', text2: '#b6b6b6', hairline: 'rgba(255, 255, 255, 0.14)',
      hover: 'rgba(255, 255, 255, 0.06)', selected: 'rgba(255, 255, 255, 0.11)', clay: '#f4896f', onClay: '#1a0c08', avatar: '#363636',
      owe: '#ddb97a', wait: '#8fb5d6', bring: '#b9a9d6', task: '#b6b6b6', said: '#9ac5a8', note: '#a0a0a0',
      accent: '#b6b6b6', shadow: 'rgba(0, 0, 0, 0.45)', scrim: 'rgba(0, 0, 0, 0.35)', sidebarBg: 'rgba(30, 30, 30, 0.78)',
    },
  },
  midnight: {
    dark: {
      bg: '#0b1020', surface: '#111a2e', elevated: '#1a2540', text: '#e9eefb', text2: '#aab5d2', hairline: 'rgba(150, 185, 255, 0.17)',
      hover: 'rgba(150, 185, 255, 0.08)', selected: 'rgba(150, 185, 255, 0.15)', clay: '#ff8f7a', onClay: '#1c0a08', avatar: '#27345a',
      owe: '#e6c57e', wait: '#80c1ff', bring: '#bcaaff', task: '#a9b6d2', said: '#80d8b4', note: '#93a0bf',
      accent: '#80b4ff', shadow: 'rgba(0, 0, 10, 0.55)', scrim: 'rgba(2, 5, 16, 0.5)', sidebarBg: 'rgba(14, 22, 42, 0.78)',
    },
  },
  forest: {
    dark: {
      bg: '#0d130f', surface: '#141c16', elevated: '#1d2820', text: '#e9f1ea', text2: '#a8bbac', hairline: 'rgba(170, 230, 185, 0.16)',
      hover: 'rgba(170, 230, 185, 0.075)', selected: 'rgba(170, 230, 185, 0.14)', clay: '#f28d6c', onClay: '#1c0b07', avatar: '#2a3b2f',
      owe: '#ddc07e', wait: '#88c1d8', bring: '#bfaad8', task: '#a8bbac', said: '#92d8a2', note: '#8fa595',
      accent: '#83d096', shadow: 'rgba(0, 8, 2, 0.55)', scrim: 'rgba(2, 10, 4, 0.5)', sidebarBg: 'rgba(18, 28, 21, 0.78)',
    },
  },
  daylight: {
    light: {
      bg: '#f3f5f8', surface: '#fafbfd', elevated: '#ffffff', text: '#12161d', text2: '#4a5361', hairline: 'rgba(15, 30, 60, 0.15)',
      hover: 'rgba(15, 30, 60, 0.05)', selected: 'rgba(15, 30, 60, 0.09)', clay: '#b0341a', onClay: '#ffffff', avatar: '#e2e8f0',
      owe: '#7b5810', wait: '#1f5d97', bring: '#5e40a0', task: '#4a5361', said: '#2b6e41', note: '#586272',
      accent: '#255f9d', shadow: 'rgba(20, 40, 80, 0.18)', scrim: 'rgba(15, 25, 50, 0.22)', sidebarBg: 'rgba(250, 251, 253, 0.8)',
    },
  },
  paper: {
    light: {
      bg: '#f3ead6', surface: '#faf3e3', elevated: '#fffaee', text: '#271f15', text2: '#5b4f3f', hairline: 'rgba(70, 45, 10, 0.18)',
      hover: 'rgba(70, 45, 10, 0.06)', selected: 'rgba(70, 45, 10, 0.1)', clay: '#a2381a', onClay: '#ffffff', avatar: '#e7dac0',
      owe: '#6f5010', wait: '#3a5d78', bring: '#684a80', task: '#5b4f3f', said: '#386840', note: '#665a49',
      accent: '#864719', shadow: 'rgba(70, 45, 10, 0.2)', scrim: 'rgba(60, 40, 10, 0.24)', sidebarBg: 'rgba(250, 243, 227, 0.82)',
    },
  },
  contrast: {
    dark: {
      bg: '#000000', surface: '#0a0a0a', elevated: '#161616', text: '#ffffff', text2: '#e2e2e2', hairline: 'rgba(255, 255, 255, 0.45)',
      hover: 'rgba(255, 255, 255, 0.12)', selected: 'rgba(255, 255, 255, 0.22)', clay: '#ff9c86', onClay: '#000000', avatar: '#2c2c2c',
      owe: '#ffd479', wait: '#90d0ff', bring: '#d2c1ff', task: '#e2e2e2', said: '#92eaaf', note: '#cfcfcf',
      accent: '#ffe066', shadow: 'rgba(0, 0, 0, 0.8)', scrim: 'rgba(0, 0, 0, 0.6)', sidebarBg: 'rgba(10, 10, 10, 0.92)',
    },
  },
};

// User accent choices; 'graphite' means "the theme's own accent". One set per kind of background.
type AccentSet = Record<Exclude<AccentChoice, 'graphite'>, string>;
const ACCENT_DARK: AccentSet = { blue: '#85b1e8', green: '#85c79b', violet: '#b4a6e6', amber: '#e2b56a' };
const ACCENT_LIGHT: AccentSet = { blue: '#235f9c', green: '#2d7048', violet: '#5e48a0', amber: '#85560e' };
const ACCENT_HC: AccentSet = { blue: '#7cc6ff', green: '#7ee59c', violet: '#cbb8ff', amber: '#ffd166' };

/** 'dark' or 'light' for a theme; Classic follows the system. */
export function themeMode(name: ThemeName, prefersDark: boolean): 'dark' | 'light' {
  const m = THEMES.find((t) => t.id === name)?.mode ?? 'system';
  return m === 'system' ? (prefersDark ? 'dark' : 'light') : m;
}

/** The token set in force for a theme (unknown names fall back to Classic). */
export function resolveTokens(name: ThemeName, prefersDark: boolean): ThemeTokens {
  const t = THEME_TOKENS[name] ?? THEME_TOKENS.classic;
  const mode = themeMode(THEME_TOKENS[name] ? name : 'classic', prefersDark);
  return (mode === 'dark' ? t.dark : t.light) ?? t.dark ?? t.light!;
}

/** Accent colour for a user choice on a theme ('graphite' = the theme's default). */
export function accentFor(name: ThemeName, choice: AccentChoice, prefersDark: boolean): string {
  const tk = resolveTokens(name, prefersDark);
  if (choice === 'graphite') return tk.accent;
  const set = name === 'contrast' ? ACCENT_HC : themeMode(name, prefersDark) === 'dark' ? ACCENT_DARK : ACCENT_LIGHT;
  return set[choice] ?? tk.accent;
}
export const ACCENT_SETS = { dark: ACCENT_DARK, light: ACCENT_LIGHT, contrast: ACCENT_HC };

/** CSS variable name -> value (the names styles.css uses). */
export function cssVars(name: ThemeName, prefersDark: boolean, accent: AccentChoice = 'graphite'): Record<string, string> {
  const t = resolveTokens(name, prefersDark);
  return {
    '--bg': t.bg, '--surface': t.surface, '--elevated': t.elevated, '--text': t.text, '--text2': t.text2, '--hairline': t.hairline,
    '--hover': t.hover, '--selected': t.selected, '--clay': t.clay, '--on-clay': t.onClay, '--avatar': t.avatar,
    '--k-owe': t.owe, '--k-wait': t.wait, '--k-bring': t.bring, '--k-task': t.task, '--k-said': t.said, '--k-note': t.note,
    '--accent': accentFor(name, accent, prefersDark), '--shadow': t.shadow, '--scrim': t.scrim, '--sidebar-bg': t.sidebarBg,
  };
}

const CACHE_KEY = 'jaffloop-theme';
const darkQuery = () => matchMedia('(prefers-color-scheme: dark)');

/** Writes the theme's variables on <html>, sets data-theme and color-scheme (native controls and scrollbars follow). */
export function applyTheme(name: ThemeName, prefersDark: boolean, accent: AccentChoice = 'graphite'): void {
  const h = document.documentElement;
  const vars = cssVars(name, prefersDark, accent);
  // "increase contrast" in macOS makes hairlines stronger on every theme
  if (matchMedia('(prefers-contrast: more)').matches) vars['--hairline'] = themeMode(name, prefersDark) === 'dark' ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.4)';
  for (const [k, v] of Object.entries(vars)) h.style.setProperty(k, v);
  h.style.colorScheme = themeMode(name, prefersDark);
  h.dataset.theme = name;
}

let current: { theme: ThemeName; accent: AccentChoice } | null = null;
let watching = false;

/** Applies the user's theme and accent, remembers them for the next start (no flash) and re-applies when the system scheme changes. */
export function applyUiTheme(theme: ThemeName, accent: AccentChoice): void {
  current = { theme, accent };
  applyTheme(theme, darkQuery().matches, accent);
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(current)); } catch { /* storage unavailable */ }
  if (!watching) {
    watching = true;
    darkQuery().addEventListener('change', () => { if (current) applyTheme(current.theme, darkQuery().matches, current.accent); });
  }
}

/** Runs before the first render: applies the last theme from localStorage so a non-Classic theme does not flash Classic. */
export function bootTheme(): void {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as { theme?: ThemeName; accent?: AccentChoice } | null;
    if (c && c.theme && THEMES.some((t) => t.id === c.theme)) applyTheme(c.theme, darkQuery().matches, c.accent ?? 'graphite');
    else applyTheme('classic', darkQuery().matches);
  } catch { /* storage unavailable: styles.css fallback applies */ }
}
