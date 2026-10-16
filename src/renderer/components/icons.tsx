// Small inline SVG icons (stroke style, 16px grid). Use <Icon name="search" size={14} />.
import type { JSX } from 'preact';

const P: Record<string, JSX.Element> = {
  search: <><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></>,
  plus: <path d="M8 3v10M3 8h10" />,
  xmark: <path d="M4 4l8 8M12 4l-8 8" />,
  check: <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />,
  chevron: <path d="M6 3.5 10.5 8 6 12.5" />,
  chevdown: <path d="M3.5 6 8 10.5 12.5 6" />,
  pin: <path d="M9.5 2.5l4 4-2 .8-2.4 2.4.3 2.3-1 1-2.6-2.6-3.7 3.7M6.3 5.7l-1.3 1.3 4 4" />,
  repeat: <><path d="M3 7V6a2 2 0 0 1 2-2h7l-1.8-1.8M13 9v1a2 2 0 0 1-2 2H4l1.8 1.8" /></>,
  calendar: <><rect x="2.5" y="3.5" width="11" height="10" rx="2" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></>,
  'calendar-plus': <><rect x="2.5" y="3.5" width="11" height="10" rx="2" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3M8 8v4M6 10h4" /></>,
  moon: <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" />,
  tray: <><path d="M2 9.5l1.7-5A1.5 1.5 0 0 1 5.1 3.5h5.8a1.5 1.5 0 0 1 1.4 1L14 9.5v2.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12Z" /><path d="M2 9.5h3.5l.7 1.5h3.6l.7-1.5H14" /></>,
  person2: <><circle cx="6" cy="5.5" r="2.3" /><path d="M2 13c0-2.2 1.8-3.8 4-3.8s4 1.6 4 3.8" /><path d="M10.5 3.5a2.3 2.3 0 0 1 0 4.3M12 9.5c1.2.5 2 1.6 2 3" /></>,
  scroll: <><path d="M4.5 2.5h7v10.5a1 1 0 0 0 1 1h-8a1 1 0 0 1-1-1V4a1.5 1.5 0 0 1 1.5-1.5Z" /><path d="M6.5 5.5h3M6.5 8h3" /></>,
  dotted: <circle cx="8" cy="8" r="5.5" stroke-dasharray="1.8 2.2" />,
  keyboard: <><rect x="1.5" y="4" width="13" height="8" rx="2" /><path d="M4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M5 9.5h6" /></>,
  sparkles: <><path d="M6.5 2.5 7.6 5.4 10.5 6.5 7.6 7.6 6.5 10.5 5.4 7.6 2.5 6.5 5.4 5.4ZM12 9.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6Z" /></>,
  sidebar: <><rect x="2" y="3" width="12" height="10" rx="2" /><path d="M6 3v10" /></>,
  bookmark: <path d="M4.5 2.5h7v11L8 10.5l-3.5 3Z" />,
  eyeslash: <><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4Z" /><circle cx="8" cy="8" r="1.8" /><path d="M3 13 13 3" /></>,
  ellipsis: <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" stroke-width="2.2" />,
  list: <path d="M5 4h8M5 8h8M5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />,
  grid: <><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" /></>,
  clock: <><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3.2l2 1.2" /></>,
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />,
  scope: <><circle cx="8" cy="8" r="4.5" /><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" /></>,
  circlex: <><circle cx="8" cy="8" r="5.5" /><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" /></>,
  circlecheck: <><circle cx="8" cy="8" r="5.5" /><path d="M5.5 8.2 7.3 10l3.3-3.8" /></>,
  sound: <path d="M3 6h2l3-2.5v9L5 10H3ZM10.5 5.5a3.5 3.5 0 0 1 0 5M12.3 3.8a6 6 0 0 1 0 8.4" />,
  arrowdown: <path d="M8 2.5v9M4.5 8 8 11.5 11.5 8" />,
  info: <><circle cx="8" cy="8" r="5.5" /><path d="M8 7.5v3.5M8 5.3h.01" /></>,
  bell: <path d="M4 11V7.5a4 4 0 0 1 8 0V11l1 1.5H3ZM6.5 14a1.6 1.6 0 0 0 3 0" />,
  drive: <><rect x="2" y="9" width="12" height="4.5" rx="1.5" /><path d="M3.5 9l1.5-5.5h6L12.5 9M11.5 11.2h.01" /></>,
  window: <><rect x="2" y="3" width="12" height="10" rx="2" /><path d="M2 6h12M4 4.5h.01M5.5 4.5h.01" /></>,
  gear: <><circle cx="8" cy="8" r="2" /><path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M3.6 12.4l1.2-1.2M11.2 4.8l1.2-1.2" /></>,
  review: <><rect x="3" y="2.5" width="10" height="11.5" rx="1.8" /><path d="M6 2.5h4v1.6H6ZM5.7 8.6l1.6 1.6 3-3.4" /></>,
  cake: <><path d="M3 13.5h10v-4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1ZM3 11.3c1.2 0 1.2.9 2.5.9s1.3-.9 2.5-.9 1.3.9 2.5.9 1.3-.9 3-.9M8 8.5V6M8 4.8c-.6-.6-.6-1.2 0-2 .6.8.6 1.4 0 2Z" /></>,
  pencil: <path d="M10.5 3l2.5 2.5-7 7L3 13l.5-3Z" />,
  'arrowup-right': <path d="M5 11 11 5M6 5h5v5" />,
  copy: <><rect x="5.5" y="5.5" width="8" height="8" rx="1.8" /><path d="M10.5 5.5v-1a1.8 1.8 0 0 0-1.8-1.8H4.5a1.8 1.8 0 0 0-1.8 1.8v4.2a1.8 1.8 0 0 0 1.8 1.8h1" /></>,
};

export function Icon({ name, size = 14, class: cls }: { name: string; size?: number; class?: string }) {
  return (
    <svg class={cls} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {P[name] ?? null}
    </svg>
  );
}
