// Work anniversaries and birthdays in the next two weeks, as up to three chips under Check in. Dismissed for the day (per session).
import { useState } from 'preact/hooks';
import { upcomingLabel } from '../core';
import { useFetched } from '../hooks/use-fetched';
import { api, go, person, ui } from '../model';
import { firstName } from '../people-logic';
import { dateKey, localDay, visibleDates } from '../reports-logic';
import { Icon } from './icons';

const KEY = 'jaffloop.dates.dismissed';
function load(): Set<string> {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as { day: string; keys: string[] } | null;
    return raw && raw.day === localDay(Date.now()) ? new Set(raw.keys) : new Set();
  } catch { return new Set(); }
}
function store(keys: Set<string>) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ day: localDay(Date.now()), keys: [...keys] })); } catch { /* private mode: dismissal lasts until the next render */ }
}

export function DateChips() {
  const list = useFetched(() => api.upcomingDates(14), []);
  const [dismissed, setDismissed] = useState(load);
  if (!ui.value.showDates || !list) return null;
  const chips = visibleDates(list, dismissed).filter((u) => person(u.personId));
  if (!chips.length) return null;
  return (
    <div class="date-chips" role="group" aria-label="Anniversaries and birthdays" data-testid="date-chips">
      {chips.map((u) => {
        const p = person(u.personId)!;
        const text = upcomingLabel(u, firstName(p.name));
        return (
          <span key={dateKey(u)} class="date-chip">
            <button type="button" class="date-chip-main" aria-label={`${text}. Open ${p.name}`} onClick={() => go(`person:${p.id}`)}>
              <Icon name="cake" size={12} /><span>{text}</span>
            </button>
            <button type="button" class="date-chip-x" aria-label={`Dismiss: ${text}`} title="Dismiss for today"
              onClick={() => { const n = new Set(dismissed); n.add(dateKey(u)); store(n); setDismissed(n); }}><Icon name="xmark" size={9} /></button>
          </span>
        );
      })}
    </div>
  );
}
