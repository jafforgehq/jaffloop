// One form for adding a person: used by the "Add your team" wizard and the People page dialog.
import { useEffect, useRef } from 'preact/hooks';
import type { Person, Relation } from '../../shared/types';
import { RELATIONS } from '../../shared/types';
import { addPerson, savePerson, summaries } from '../model';
import { CADENCE_PRESETS, MONTHS, type PersonDraft, daysInMonth, draftError, draftFields } from '../onboarding-logic';
import { Segmented } from './ui';

/** Creates the person (addPerson) and saves the draft's fields on top. A handle that exists is reported and nothing is overwritten. */
export async function createFromDraft(d: PersonDraft): Promise<{ person: Person } | { error: string }> {
  const error = draftError(d, summaries.value.map((s) => s.person));
  if (error) return { error };
  const p = await addPerson(d.name.trim());
  if (!p) return { error: 'Could not add this person.' };
  const saved: Person = { ...p, ...draftFields(d) };
  await savePerson(saved);
  return { person: saved };
}

const cadenceValue = (c: number): string => (c === 0 ? 'none' : (CADENCE_PRESETS as readonly number[]).includes(c) ? String(c) : '');

/** The fields only; the caller owns the draft, the buttons and what Enter does. Mount it with a new key to start a fresh form (the name gets focus). */
export function PersonForm({ draft, onChange, error, onSubmit }: { draft: PersonDraft; onChange: (d: PersonDraft) => void; error?: string | null; onSubmit?: () => void }) {
  const name = useRef<HTMLInputElement>(null);
  useEffect(() => { name.current?.focus(); }, []);
  const set = <K extends keyof PersonDraft>(k: K, v: PersonDraft[K]) => onChange({ ...draft, [k]: v });
  const step = (d: number) => set('cadence', Math.min(90, Math.max(0, draft.cadence + d)));
  const days = Array.from({ length: draft.birthMonth ? daysInMonth(draft.birthMonth) : 31 }, (_, i) => i + 1);
  return (
    <div class="pform" data-testid="person-form" onKeyDown={(e) => { if (e.key === 'Enter' && !e.isComposing && !e.metaKey && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); onSubmit?.(); } }}>
      <label class="pf-field">Name
        <input ref={name} class="input" aria-label="Name" placeholder="Sara Lindqvist" value={draft.name} onInput={(e) => set('name', (e.target as HTMLInputElement).value)} />
      </label>
      {error && <div class="pf-error" role="alert">{error}</div>}
      <label class="pf-field">Position
        <input class="input" aria-label="Position" placeholder="Staff engineer" value={draft.title} onInput={(e) => set('title', (e.target as HTMLInputElement).value)} />
      </label>
      <label class="pf-field">Relation
        <select class="input" aria-label="Relation" value={draft.relation} onChange={(e) => set('relation', (e.target as HTMLSelectElement).value as Relation)}>
          {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      <div class="pf-field">1:1 cadence
        <div class="row-flex gap10">
          <Segmented label="1:1 cadence" value={cadenceValue(draft.cadence)} onChange={(v) => set('cadence', v === 'none' ? 0 : Number(v))}
            options={[...CADENCE_PRESETS.map((c) => ({ value: String(c), label: String(c), aria: `Every ${c} days` })), { value: 'none', label: 'None', aria: 'No cadence' }]} />
          <span class="row-flex gap6">
            <button type="button" class="btn icon" aria-label="Fewer days" disabled={draft.cadence <= 0} onClick={() => step(-1)}>−</button>
            <span class="tnum dim pf-days" data-testid="cadence-text">{draft.cadence === 0 ? 'no cadence' : `every ${draft.cadence} days`}</span>
            <button type="button" class="btn icon" aria-label="More days" disabled={draft.cadence >= 90} onClick={() => step(1)}>+</button>
          </span>
        </div>
      </div>
      <div class="pf-field"><span>Birthday <span class="dim pf-opt">optional, the year is not needed</span></span>
        <div class="row-flex gap8">
          <select class="input" style={{ width: 140 }} aria-label="Birthday month" value={draft.birthMonth}
            onChange={(e) => { const m = Number((e.target as HTMLSelectElement).value); onChange({ ...draft, birthMonth: m, birthDay: m ? Math.min(draft.birthDay, daysInMonth(m)) : 0 }); }}>
            <option value={0}>Month</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select class="input" style={{ width: 90 }} aria-label="Birthday day" value={draft.birthDay} disabled={!draft.birthMonth} onChange={(e) => set('birthDay', Number((e.target as HTMLSelectElement).value))}>
            <option value={0}>Day</option>
            {days.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>
      <label class="pf-field"><span>Start date <span class="dim pf-opt">optional</span></span>
        <input type="date" class="input date-input" aria-label="Start date" value={draft.startDate} onInput={(e) => set('startDate', (e.target as HTMLInputElement).value)} />
      </label>
      <label class="pf-field"><span>Work emails <span class="dim pf-opt">optional, used to match meeting invites</span></span>
        <input class="input" aria-label="Work emails" placeholder="sara@company.com" spellcheck={false} value={draft.emails} onInput={(e) => set('emails', (e.target as HTMLInputElement).value)} />
      </label>
    </div>
  );
}
