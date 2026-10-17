// One item in a list: ring, title (double click to edit), badges, hover actions and the kind/person/date columns.
// Ported from Components.swift ItemRow / SnoozeMenu.
import { useSignalEffect } from '@preact/signals';
import { useRef, useState } from 'preact/hooks';
import type { Density } from '../../shared/api';
import type { Item } from '../../shared/types';
import { Fmt } from '../core';
import {
  complete, copyNudge, dragPayload, drop, filterTodayBy, movePin, multi, openItems, person, rename, selectedItemId, settings, snooze, snoozePresetsFor, toggleMulti, togglePin,
  triggerComplete, triggerEdit, ui, updateItem, drawerItemId,
} from '../model';
import { tip } from '../help';
import { firstName as firstOf } from '../speed-logic';
import { Dropdown } from './dropdown';
import { DueEditor } from './due-editor';
import { Icon } from './icons';
import { LinkedTitle } from './linked-title';
import { Avatar, KindLabel, LoopRing, Popover, openContextMenu } from './ui';

const PAD: Record<Density, number> = { compact: 4, comfortable: 7, spacious: 11 };
const firstName = firstOf;

/** Snooze menu (presets + a custom date). `onPick` gets the epoch ms to come back at. */
export function SnoozeMenu({ onPick, label = 'Snooze', face, className, item, title }: { onPick: (until: number) => void; label?: string; face?: preact.ComponentChildren; className?: string; item?: Pick<Item, 'personId'> | null; title?: string }) {
  const [custom, setCustom] = useState(false);
  const [value, setValue] = useState(() => toLocalInput(Date.now() + 3 * 3_600_000));
  const wrap = useRef<HTMLSpanElement>(null);
  const items = [
    ...snoozePresetsFor(item).map((p) => ({ label: p.label, onClick: () => onPick(p.date) })),
    { divider: true },
    { label: 'Custom…', onClick: () => setCustom(true) },
  ];
  return (
    <span ref={wrap} class="row-flex">
      <Dropdown label={label} title={title ?? tip('row.snooze')} className={className} face={face ?? <Icon name="clock" size={13} />} items={items} />
      <Popover anchor={wrap.current} open={custom} onClose={() => setCustom(false)} width={240}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input type="datetime-local" class="input" aria-label="Snooze until" value={value} onInput={(e) => setValue((e.target as HTMLInputElement).value)} />
          <button type="button" class="btn primary" disabled={!value} onClick={() => { const t = new Date(value).getTime(); if (!Number.isNaN(t)) { setCustom(false); onPick(t); } }}>Snooze</button>
        </div>
      </Popover>
    </span>
  );
}

function toLocalInput(ms: number): string {
  const d = new Date(ms), p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ItemRow({ item, index = 0, showPerson = true, showKind = true, compact = false, densityOverride }: {
  item: Item; index?: number; showPerson?: boolean; showKind?: boolean; compact?: boolean; densityOverride?: Density;
}) {
  const [ringHover, setRingHover] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [ghost, setGhost] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [showDue, setShowDue] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const dueBtn = useRef<HTMLButtonElement>(null);
  const dueClosedAt = useRef(0);

  const density: Density = compact ? 'compact' : (densityOverride ?? ui.value.density);
  const now = Date.now();
  const overdue = Fmt.isOverdue(item, now);
  const slipping = Fmt.isSlipping(item);
  const selected = selectedItemId.value === item.id;
  const inMulti = multi.value.has(item.id);
  const p = person(item.personId);
  const dueText = Fmt.due(item, now);
  const age = compact ? null : Fmt.ageBadge(item, now);

  const beginEdit = () => { setDraft(item.title); setEditing(true); };
  const commitEdit = () => {
    setEditing(false);
    const t = draft.trim();
    if (t && t !== item.title) void rename(item, t);
  };
  const finish = () => {
    if (completing) return;
    setCompleting(true);
    setTimeout(() => {
      if (root.current) root.current.style.height = `${root.current.offsetHeight}px`;
      requestAnimationFrame(() => setCollapsed(true));
      setTimeout(() => { void complete(item); }, 200);
    }, 360);
  };
  const snoozeRow = (until: number) => {
    setGhost(Fmt.backLabel(until));
    setTimeout(() => { void snooze(item, until); }, 550);
  };
  const details = () => { selectedItemId.value = item.id; drawerItemId.value = item.id; };

  useSignalEffect(() => {
    if (triggerComplete.value === item.id) { triggerComplete.value = null; finish(); }
    if (triggerEdit.value === item.id) { triggerEdit.value = null; beginEdit(); }
  });

  const onClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button,input,a,.menu')) return;
    if (e.shiftKey || e.metaKey) toggleMulti(item.id);
    else { multi.value = new Set(); selectedItemId.value = item.id; }
  };
  const onDrop = (e: DragEvent) => {
    // dropping one pinned item onto another reorders the pins
    const payload = e.dataTransfer?.getData('text/plain') ?? '';
    if (!item.pinned || !payload || payload === item.id || payload.includes(',')) return;
    if (openItems.value.find((i) => i.id === payload)?.pinned !== true) return;
    e.preventDefault();
    movePin(payload, item.id);
  };

  const nudge = item.kind === 'wait' && p ? [{ label: 'Copy nudge message', hint: tip('row.nudge'), onClick: () => copyNudge(item) }] : [];
  const stale = age != null && Fmt.isStaleWait(item, now, settings.value);
  const level = age != null ? Fmt.ageLevel(age) : 0;
  const rule = item.recurRule;
  const dueTip = Fmt.exact(item);
  const style = { '--row-pad': `${PAD[density]}px`, '--row-font': density === 'spacious' ? '14px' : '13px', animationDelay: `${Math.min(index, 14) * 24}ms` };

  return (
    <div ref={root} class={`row ${selected ? 'selected' : ''} ${inMulti ? 'multi' : ''} ${compact ? 'compact-cols' : ''} ${collapsed ? 'removing' : ''} ${ghost ? 'ghost' : ''}`}
      role="option" aria-selected={selected} data-item-id={item.id} data-kind={item.kind} style={style as never}
      draggable={!editing}
      onDragStart={(e) => { e.dataTransfer?.setData('text/plain', dragPayload(item.id)); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={(e) => { if (item.pinned) e.preventDefault(); }}
      onDrop={onDrop}
      onClick={onClick}
      onContextMenu={(e) => openContextMenu(e, [
        { label: 'Complete', hint: tip('row.complete'), onClick: finish },
        { label: 'Edit title', hint: tip('row.edit'), onClick: beginEdit },
        { label: 'Details', hint: tip('row.details'), onClick: details },
        ...nudge,
        ...snoozePresetsFor(item).map((s) => ({ label: `Snooze: ${s.label}`, hint: tip('row.snoozeSet'), onClick: () => snoozeRow(s.date) })),
        { divider: true },
        { label: item.pinned ? 'Unpin' : 'Pin to top', hint: tip('row.pin'), onClick: () => { void togglePin(item); } },
        { label: 'Drop', hint: tip('row.drop'), danger: true, onClick: () => { void drop(item); } },
      ])}>
      <button type="button" class="ring-btn" aria-label={`Complete ${item.title}`} title={tip('row.complete')} onClick={(e) => { e.stopPropagation(); finish(); }}
        onMouseEnter={() => setRingHover(true)} onMouseLeave={() => setRingHover(false)}>
        <LoopRing size={16} hot={overdue || slipping} closed={completing} preview={ringHover && !completing} />
      </button>

      <div class="title-cell">
        {editing ? (
          <input class="row-edit" aria-label="Title" value={draft} ref={(el) => { if (el && document.activeElement !== el) { el.focus(); el.select(); } }}
            onInput={(e) => setDraft((e.target as HTMLInputElement).value)} onBlur={commitEdit}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commitEdit(); else if (e.key === 'Escape') setEditing(false); }} />
        ) : (
          <div class="row-title" title={item.title} onDblClick={beginEdit}><LinkedTitle text={item.title} /></div>
        )}
        {!editing && density !== 'compact' && item.body && <div class="row-body">{item.body}</div>}
        {ghost && <div class="row-ghost">{ghost}</div>}
      </div>

      {rule && <span class="dim" title={`Repeats ${Fmt.recurrenceText(rule)}. ${tip('row.repeat')}`} aria-label={`Repeats ${Fmt.recurrenceText(rule)}`}><Icon name="repeat" size={11} /></span>}
      {age != null && (
        <span class="mono age" data-level={level} style={{ color: ['var(--text2)', 'var(--k-owe)', 'var(--clay)'][level], textDecoration: stale ? 'underline' : 'none', textDecorationColor: 'var(--clay)' }}
          title={stale ? `Stale: waiting longer than your limit. Open ${age} days.` : `Open for ${age} days, since ${Fmt.short(item.createdAt, 'EEEE d MMMM')}. ${tip('row.age')}`}>{age}d</span>
      )}
      {item.pinned && <span class="dim" aria-label="Pinned" title={tip('row.pinned')}><Icon name="pin" size={11} /></span>}
      {slipping && <span class="pill mono" title={`Snoozed ${item.snoozeCount} times. ${tip('row.slipping')}`}>{compact ? `×${item.snoozeCount}` : `slipping ×${item.snoozeCount}`}</span>}

      {!ghost && !editing && (
        <span class="hover-only">
          <SnoozeMenu item={item} onPick={snoozeRow} />
          <Dropdown label="More actions" title={tip('row.more')} face={<Icon name="ellipsis" size={14} />} items={[
            { label: 'Edit title', hint: tip('row.edit'), onClick: beginEdit },
            { label: 'Details', hint: tip('row.details'), onClick: details },
            ...nudge,
            { label: item.pinned ? 'Unpin' : 'Pin to top', hint: tip('row.pin'), onClick: () => { void togglePin(item); } },
            { label: 'Drop', hint: tip('row.drop'), danger: true, onClick: () => { void drop(item); } },
          ]} />
        </span>
      )}

      {showKind && <span class="c-kind"><KindLabel kind={item.kind} /></span>}
      {showPerson && (
        <span class="c-person">{p && (
          <button type="button" class="person-hit" title={`Show only ${firstName(p.name)}. ${tip('row.person')}`} aria-label={`Show only ${firstName(p.name)} on Today`}
            onClick={(e) => { e.stopPropagation(); filterTodayBy(p.id); }}><Avatar person={p} size={16} /><span class="ellipsis">{firstName(p.name)}</span></button>
        )}</span>
      )}
      <button type="button" ref={dueBtn} class={`c-date date-btn ${overdue ? 'overdue' : ''} ${dueText ? '' : 'empty'}`}
        title={dueTip ? `${dueTip}. ${tip('row.due')}` : tip('row.due')}
        aria-label={dueText ? `${overdue ? 'Overdue, ' : 'Due '}${dueText}. Change date` : 'Set a due date'}
        onClick={(e) => { e.stopPropagation(); if (Date.now() - dueClosedAt.current < 250) return; setShowDue(true); }}>
        {dueText ?? (compact ? null : <Icon name="calendar-plus" size={12} />)}
      </button>
      <Popover anchor={dueBtn.current} open={showDue} onClose={() => { dueClosedAt.current = Date.now(); setShowDue(false); }} width={280}>
        <DueEditor current={item.dueAt} hasTime={item.dueHasTime} onApply={(d, t) => {
          setShowDue(false);
          void updateItem(item, d == null ? 'Due date cleared' : 'Due date changed', { dueAt: d, dueHasTime: t });
        }} />
      </Popover>
    </div>
  );
}

export function ItemList({ items, showPerson = true, showKind = true }: { items: Item[]; showPerson?: boolean; showKind?: boolean }) {
  return (
    <div class="rows" role="listbox" aria-multiselectable="true" aria-label="Items">
      {items.map((i, idx) => <ItemRow key={i.id} item={i} index={idx} showPerson={showPerson} showKind={showKind} />)}
    </div>
  );
}
