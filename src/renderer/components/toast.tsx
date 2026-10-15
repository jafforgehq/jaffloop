// Undo toast and the bulk-action bar. Both render into the .toast-wrap column at the bottom of the main window.
import { assignMany, completeMany, dropMany, multi, orderedPeople, snoozeMany, toast, undoLast } from '../model';
import { Dropdown } from './dropdown';
import { SnoozeMenu } from './item-row';
import { Kbd, PrimaryButton, QuietButton } from './ui';

export function ToastBar() {
  const t = toast.value;
  if (!t) return null;
  return (
    <div class="pillbar toast" key={t.id} role="status" aria-live="polite">
      <span class="toast-msg">{t.message}</span>
      {t.undo && (
        <button type="button" class="toast-undo" onClick={undoLast} aria-label="Undo">
          <b>Undo</b><Kbd>⌘Z</Kbd>
        </button>
      )}
    </div>
  );
}

export function BulkBar() {
  const ids = [...multi.value];
  if (!ids.length) return null;
  return (
    <div class="pillbar bulk" role="toolbar" aria-label="Bulk actions">
      <span style={{ fontWeight: 500 }}>{ids.length} selected</span>
      <PrimaryButton onClick={() => { void completeMany(ids); }}>Complete</PrimaryButton>
      <SnoozeMenu className="btn quiet" label="Snooze" face="Snooze" onPick={(until) => { void snoozeMany(ids, until); }} />
      <Dropdown label="Assign" className="btn quiet" face="Assign"
        items={orderedPeople.value.map((s) => ({ label: s.person.name, onClick: () => { void assignMany(ids, s.person.handle); } }))} />
      <button type="button" class="btn quiet" style={{ color: 'var(--clay)' }} onClick={() => { void dropMany(ids); }}>Drop</button>
      <QuietButton onClick={() => { multi.value = new Set(); }}>Clear</QuietButton>
    </div>
  );
}
