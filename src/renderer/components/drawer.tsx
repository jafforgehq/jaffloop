// Details drawer: every field of an item is editable. Ported from Selection.swift ItemDrawer.
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ITEM_KINDS } from '../../shared/types';
import type { Item } from '../../shared/types';
import { api, complete, drawerItemId, drop, orderedPeople, person, reopen, rename, setTags, snooze, togglePin, updateItem } from '../model';
import { Fmt } from '../core';
import { Caret, Dropdown } from './dropdown';
import { DueEditor } from './due-editor';
import { SnoozeMenu } from './item-row';
import { Icon } from './icons';
import { Avatar, KindLabel, Popover, PrimaryButton, QuietButton } from './ui';

function Field({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="drawer-field">
      <span class="caps drawer-label">{label}</span>
      <span class="drawer-value">{children}</span>
    </div>
  );
}

export function ItemDrawer({ item }: { item: Item }) {
  const [title, setTitle] = useState(item.title);
  const [bodyText, setBodyText] = useState(item.body ?? '');
  const [tagText, setTagText] = useState('');
  const [showDue, setShowDue] = useState(false);
  const titleEl = useRef<HTMLTextAreaElement>(null);
  const dueBtn = useRef<HTMLButtonElement>(null);
  const dueClosedAt = useRef(0);
  const tagsDirty = useRef(false);
  const latest = useRef({ item, title, bodyText, tagText });
  latest.current = { item, title, bodyText, tagText };

  // follow outside changes (undo, renames from the list) unless the field is being typed in
  useEffect(() => { if (document.activeElement !== titleEl.current) setTitle(item.title); }, [item.title]);
  useEffect(() => { if (!(document.activeElement as HTMLElement | null)?.classList.contains('drawer-body')) setBodyText(item.body ?? ''); }, [item.body]);
  useEffect(() => {
    let live = true;
    void api.tagsOf(item.id).then((t) => { if (live && !(document.activeElement as HTMLElement | null)?.classList.contains('drawer-tags')) setTagText(t.join(', ')); });
    return () => { live = false; };
  }, [item.id, item.updatedAt]);
  useLayoutEffect(() => { const el = titleEl.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }, [title]);

  const commitTitle = () => {
    const { item: it, title: t0 } = latest.current;
    const t = t0.trim();
    if (!t) setTitle(it.title); else if (t !== it.title) void rename(it, t);
  };
  const commitBody = () => {
    const { item: it, bodyText: b } = latest.current;
    const t = b.trim();
    if (t !== (it.body ?? '')) void updateItem(it, 'Details updated', { body: t === '' ? null : t });
  };
  const commitTags = () => {
    if (!tagsDirty.current) return;
    tagsDirty.current = false;
    const { item: it, tagText: t } = latest.current;
    void setTags(it, t.split(','));
  };
  // like onDisappear in the Swift drawer: nothing typed is lost when the drawer closes or switches item
  useEffect(() => () => { commitTitle(); commitBody(); commitTags(); }, []);

  const p = person(item.personId);
  const exact = Fmt.exact(item);
  const overdue = Fmt.isOverdue(item);
  const isOpen = item.status === 'open';

  return (
    <aside class="drawer" aria-label="Item details" onKeyDown={(e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      (document.activeElement as HTMLElement | null)?.blur();
      drawerItemId.value = null;
    }}>
      <div class="row-flex" style={{ justifyContent: 'space-between' }}>
        <div class="row-flex gap8">
          <Dropdown label={`Kind: ${item.kind}. Change`} title="Change kind" className="btn quiet" face={<Caret><KindLabel kind={item.kind} /></Caret>}
            items={ITEM_KINDS.map((k) => ({ label: k, checked: k === item.kind, onClick: () => { void updateItem(item, `Now ${k}`, { kind: k }); } }))} />
          {!isOpen && <span class="mono dim">{item.status}</span>}
        </div>
        <button type="button" class="btn quiet icon nodrag" aria-label="Close details" title="Close  esc" onClick={() => { drawerItemId.value = null; }}><Icon name="xmark" size={11} /></button>
      </div>

      <textarea ref={titleEl} class="drawer-title" rows={1} aria-label="Title" value={title}
        onInput={(e) => setTitle((e.target as HTMLTextAreaElement).value)} onBlur={commitTitle}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLElement).blur(); } }} />
      {item.quote && <div class="quote" style={{ fontSize: 13, marginTop: 8 }}>“{item.quote}”</div>}

      <textarea class="drawer-body" placeholder="Add details" aria-label="Details" value={bodyText}
        onInput={(e) => setBodyText((e.target as HTMLTextAreaElement).value)} onBlur={commitBody} />
      <hr class="hairline" style={{ margin: '14px 0' }} />

      <div class="drawer-fields">
        <Field label="Person">
          <Dropdown label="Person. Change" title="Change person" className="btn quiet" align="right"
            face={<Caret>{p ? <><Avatar person={p} size={16} /><span>{p.name}</span></> : <span class="dim">No one</span>}</Caret>}
            items={[
              { label: 'No one', checked: !p, onClick: () => { void updateItem(item, 'Person removed', { personId: null }); } },
              ...orderedPeople.value.map((s) => ({ label: s.person.name, checked: s.person.id === item.personId, onClick: () => { void updateItem(item, `Assigned to ${s.person.name}`, { personId: s.person.id }); } })),
            ]} />
        </Field>
        <Field label="Due">
          <button type="button" ref={dueBtn} class="drawer-due" aria-label={exact ? `Due ${exact}. Change date` : 'Set a due date'}
            style={{ color: exact == null ? 'var(--text2)' : overdue ? 'var(--clay)' : 'var(--text)' }}
            onClick={() => { if (Date.now() - dueClosedAt.current < 250) return; setShowDue(true); }}>
            {exact ?? 'Set a date'} <Icon name="calendar" size={11} />
          </button>
          <Popover anchor={dueBtn.current} open={showDue} onClose={() => { dueClosedAt.current = Date.now(); setShowDue(false); }} width={280}>
            <DueEditor current={item.dueAt} hasTime={item.dueHasTime} onApply={(d, t) => {
              setShowDue(false);
              void updateItem(item, d == null ? 'Due date cleared' : 'Due date changed', { dueAt: d, dueHasTime: t });
            }} />
          </Popover>
        </Field>
        {item.remindAt != null && <Field label="Reminder">{Fmt.short(item.remindAt, 'EEE d MMM HH:mm')}</Field>}
        {item.recurRule && <Field label="Repeats">{Fmt.recurrenceText(item.recurRule)}</Field>}
        <Field label="Created">{Fmt.short(item.createdAt, 'd MMM yyyy')}</Field>
        <Field label="Last touched">{Fmt.short(item.lastTouchedAt, 'd MMM yyyy')}</Field>
        {item.snoozeCount > 0 && <Field label="Snoozed"><span style={{ color: Fmt.isSlipping(item) ? 'var(--clay)' : undefined }}>{item.snoozeCount} time{item.snoozeCount === 1 ? '' : 's'}</span></Field>}
        <Field label="Source">{item.source}</Field>
        <Field label="Tags">
          <input class="drawer-tags" placeholder="tag, tag" aria-label="Tags" value={tagText}
            onInput={(e) => { tagsDirty.current = true; setTagText((e.target as HTMLInputElement).value); }} onBlur={commitTags}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitTags(); } }} />
        </Field>
      </div>

      <div class="drawer-actions">
        {isOpen ? (
          <>
            <PrimaryButton onClick={() => { void complete(item); }}>Complete</PrimaryButton>
            <SnoozeMenu className="btn quiet" label="Snooze" face={<Caret>Snooze</Caret>} onPick={(until) => { void snooze(item, until); }} />
            <QuietButton onClick={() => { void togglePin(item); }}>{item.pinned ? 'Unpin' : 'Pin'}</QuietButton>
            <QuietButton onClick={() => { void drop(item); }}>Drop</QuietButton>
          </>
        ) : (
          <QuietButton onClick={() => { void reopen(item); }}>Reopen</QuietButton>
        )}
      </div>
    </aside>
  );
}
