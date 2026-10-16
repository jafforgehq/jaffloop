// Theme list shared by the main process (needs the mode to set nativeTheme) and the renderer (needs the colours, in src/renderer/themes.ts).
export type ThemeName = 'classic' | 'graphite' | 'midnight' | 'forest' | 'daylight' | 'paper' | 'contrast';
/** 'system' follows macOS light/dark (only Classic does); the others are fixed. */
export type ThemeMode = 'system' | 'dark' | 'light';

export interface ThemeMeta { id: ThemeName; label: string; mode: ThemeMode }

export const THEMES: ThemeMeta[] = [
  { id: 'classic', label: 'Classic (follows macOS)', mode: 'system' },
  { id: 'graphite', label: 'Graphite', mode: 'dark' },
  { id: 'midnight', label: 'Midnight', mode: 'dark' },
  { id: 'forest', label: 'Forest', mode: 'dark' },
  { id: 'daylight', label: 'Daylight', mode: 'light' },
  { id: 'paper', label: 'Paper', mode: 'light' },
  { id: 'contrast', label: 'High contrast', mode: 'dark' },
];
