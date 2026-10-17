// Undo toast and the bulk-action bar. Both render into the .toast-wrap column at the bottom of the main window.
import { assignMany, completeMany, dropMany, multi, openItems, orderedPeople, snoozeMany, toast, undoLast } from '../model';
import { tip } from '../help';
import { Dropdown } from './dropdown';
import { Help } from './info';
import { SnoozeMenu } from './item-row';
import { Kbd, PrimaryButton, QuietButton } from './ui';

export function ToastBar() {
  const t = toast.value;
  if (!t) return null;
  return (
    <div class="pillbar toast" key={t.id} role="status" aria-live="polite">
      <span class="toast-msg">{t.message}</span>
      {t.undo && (
        <button type="button" class="toast-undo" onClick={undoLast} aria-label="Undo" title={tip('toast.undo')}>
          <b>Undo</b><Kbd>⌘Z</Kbd>
        </button>
      )}
    </div>
  );
}

export function BulkBar() {
  const ids = [...multi.value];
  if (!ids.length) return null;
  // the "until next 1:1" preset is offered when everything marked belongs to one person
  const owners = new Set(openItems.value.filter((i) => multi.value.has(i.id)).map((i) => i.personId));
  const shared = owners.size === 1 ? { personId: [...owners][0]! } : null;
  return (
    <div class="pillbar bulk" role="toolbar" aria-label="Bulk actions">
      <span class="row-flex" style={{ fontWeight: 500 }}>{ids.length} selected<Help id="bulk.marked" /></span>
      <PrimaryButton title={tip('bulk.complete')} onClick={() => { void completeMany(ids); }}>Complete</PrimaryButton>
      <SnoozeMenu className="btn quiet" label="Snooze" title={tip('bulk.snooze')} face="Snooze" item={shared} onPick={(until) => { void snoozeMany(ids, until); }} />
      <Dropdown label="Assign" title={tip('bulk.assign')} className="btn quiet" face="Assign"
        items={orderedPeople.value.map((s) => ({ label: s.person.name, onClick: () => { void assignMany(ids, s.person.handle); } }))} />
      <button type="button" class="btn quiet" style={{ color: 'var(--clay)' }} title={tip('bulk.drop')} onClick={() => { void dropMany(ids); }}>Drop</button>
      <QuietButton title={tip('bulk.clear')} onClick={() => { multi.value = new Set(); }}>Clear</QuietButton>
    </div>
  );
}
