// "Add your team": one person per step, the people added so far on the right. Opens from the welcome screen, the People page and Settings.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Person } from '../../shared/types';
import { Icon } from '../components/icons';
import { PersonForm, createFromDraft } from '../components/person-form';
import { GhostButton, Kbd, PrimaryButton } from '../components/ui';
import { closeOnboarding, go, showOnboarding, showToast } from '../model';
import { type PersonDraft, emptyDraft } from '../onboarding-logic';

export function OnboardingView() {
  if (!showOnboarding.value) return null;
  return <Wizard />;
}

const peopleText = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

function Wizard() {
  const [draft, setDraft] = useState<PersonDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Person[]>([]);
  const [round, setRound] = useState(0); // a new form (and focus in the name field) after each save
  const [busy, setBusy] = useState(false);
  const empty = !draft.name.trim();

  const finish = (n: number) => {
    closeOnboarding();
    if (n > 0) { go('people'); showToast(`Added ${peopleText(n)}`); }
  };
  const save = async (): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    const r = await createFromDraft(draft);
    setBusy(false);
    if ('error' in r) { setError(r.error); return false; }
    setAdded((a) => [...a, r.person]);
    setDraft(emptyDraft());
    setError(null);
    setRound((n) => n + 1);
    return true;
  };
  const done = async () => {
    if (empty) { finish(added.length); return; }
    if (await save()) finish(added.length + 1);
  };

  const latest = useRef(save); // the key handler must see the form as it is now, not as of the last effect run
  latest.current = save;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeOnboarding(); }
      else if (e.key === 'Enter' && e.metaKey && !e.isComposing) { e.preventDefault(); void latest.current(); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);

  return (
    <div class="overlay center">
      <div class="card ob-card" role="dialog" aria-label="Add your team">
        <div class="ob-main">
          <h2 class="title" style={{ fontSize: 22 }}>Add your team</h2>
          <div class="dim" style={{ fontSize: 12.5 }}>One person at a time. Everything can be changed later on their page.</div>
          <PersonForm key={round} draft={draft} onChange={(d) => { setDraft(d); if (error) setError(null); }} error={error} onSubmit={() => void save()} />
          <div class="row-flex gap8 ob-buttons">
            <GhostButton onClick={() => closeOnboarding()} title="Close without saving this person">Skip</GhostButton>
            <span class="grow" />
            <GhostButton onClick={() => void done()} disabled={busy || (empty && added.length === 0)}>Done</GhostButton>
            <PrimaryButton onClick={() => void save()} disabled={busy || empty}>Save and add another <Kbd>⌘⏎</Kbd></PrimaryButton>
          </div>
        </div>
        <aside class="ob-side" aria-label="People added so far" data-testid="added-list">
          <div class="caps">Added so far{added.length > 0 && <span class="dim tnum"> · {added.length}</span>}</div>
          {added.length === 0 && <div class="dim" style={{ fontSize: 12.5 }}>No one yet.</div>}
          {added.map((p) => (
            <div key={p.id} class="ob-added" data-testid="added-person">
              <span class="ob-tick"><Icon name="check" size={11} /></span>
              <span class="grow">
                <span class="ob-name">{p.name}</span>
                {p.title && <span class="dim ob-title">{p.title}</span>}
              </span>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
