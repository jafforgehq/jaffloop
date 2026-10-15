// Due date editor shown inside a Popover (row date click, details drawer). Ported from Editors.swift DueEditor.
import { useState } from 'preact/hooks';
import { Fmt } from '../core';
import { addDays, nextMonday, startOfDay } from '../ui-logic';
import { Icon } from './icons';
import { GhostButton, PrimaryButton, QuietButton } from './ui';

const pad = (n: number) => String(n).padStart(2, '0');

export function DueEditor({ current, hasTime, onApply }: { current: number | null; hasTime: boolean; onApply: (due: number | null, hasTime: boolean) => void }) {
  const initial = current ?? new Date(startOfDay(Date.now())).setHours(9, 0, 0, 0);
  const [day, setDay] = useState(startOfDay(initial));
  const [month, setMonth] = useState(() => { const d = new Date(initial); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); });
  const [withTime, setWithTime] = useState(hasTime);
  const [time, setTime] = useState(`${pad(new Date(initial).getHours())}:${pad(new Date(initial).getMinutes())}`);

  const today = startOfDay(Date.now());
  const preset = (label: string, ms: number) => <GhostButton onClick={() => onApply(ms, false)}>{label}</GhostButton>;

  // six weeks starting on the Monday on or before the 1st
  const first = new Date(month);
  const gridStart = addDays(month, -((first.getDay() + 6) % 7));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const shiftMonth = (n: number) => { const d = new Date(month); setMonth(new Date(d.getFullYear(), d.getMonth() + n, 1).getTime()); };

  const apply = () => {
    if (!withTime) return onApply(day, false);
    const [h, m] = time.split(':').map(Number);
    onApply(new Date(day).setHours(h || 0, m || 0, 0, 0), true);
  };

  return (
    <div class="due-editor" style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 256 }}>
      <div class="row-flex gap6" style={{ flexWrap: 'wrap' }}>
        {preset('Today', today)}
        {preset('Tomorrow', addDays(today, 1))}
        {preset('Next Mon', nextMonday(Date.now()))}
        {preset('+1 week', addDays(today, 7))}
      </div>
      <div class="cal" role="group" aria-label="Choose a date">
        <div class="row-flex" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontWeight: 600 }}>{Fmt.short(month, 'MMMM yyyy')}</span>
          <span class="row-flex">
            <button type="button" class="btn quiet icon" aria-label="Previous month" onClick={() => shiftMonth(-1)}><Icon name="chevron" size={11} class="flip" /></button>
            <button type="button" class="btn quiet icon" aria-label="Next month" onClick={() => shiftMonth(1)}><Icon name="chevron" size={11} /></button>
          </span>
        </div>
        <div class="cal-grid">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} class="cal-dow">{d}</span>)}
          {cells.map((c) => {
            const out = new Date(c).getMonth() !== first.getMonth();
            return (
              <button type="button" key={c} class={`cal-day ${c === day ? 'on' : ''} ${c === today ? 'today' : ''} ${out ? 'out' : ''}`}
                aria-label={Fmt.short(c, 'EEEE d MMMM yyyy')} aria-pressed={c === day} onClick={() => setDay(c)} onDblClick={() => { setDay(c); onApply(c, false); }}>
                {new Date(c).getDate()}
              </button>
            );
          })}
        </div>
      </div>
      <label class="row-flex gap8" style={{ fontSize: 12 }}>
        <input type="checkbox" checked={withTime} onChange={(e) => setWithTime((e.target as HTMLInputElement).checked)} /> Include a time
        {withTime && <input type="time" class="input" style={{ width: 96, padding: '2px 6px' }} value={time} aria-label="Time" onInput={(e) => setTime((e.target as HTMLInputElement).value)} />}
      </label>
      <div class="row-flex" style={{ justifyContent: 'space-between' }}>
        {current != null ? <QuietButton onClick={() => onApply(null, false)}>Clear</QuietButton> : <span />}
        <PrimaryButton onClick={apply}>Set</PrimaryButton>
      </div>
    </div>
  );
}
