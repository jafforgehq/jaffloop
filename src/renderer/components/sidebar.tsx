// Left sidebar: search, navigation with counts, people (drop targets), saved filters, tags and the capture/update footer.
// Ported from MainView.swift Sidebar / PersonNavRow / NavRow / NavItem / UpdateBadge.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Fmt } from '../core';
import {
  api, assignMany, go, hasUnseenRelease, info, isCollapsed, nav, orderedPeople, overdueCount, removeFilter, settings, showSearch, snapshot, toggleCollapsed,
  togglePinnedPerson, ui, updateState,
} from '../model';
import { tip } from '../help';
import { inboxBadge } from '../onboarding-logic';
import { todayTotal } from '../ui-logic';
import { Icon } from './icons';
import { Avatar, Dot, Kbd, openContextMenu } from './ui';
import type { PersonSummary } from '../../shared/types';

function NavRow({ selected, onClick, children, title, label, extra, dropTarget }: {
  selected: boolean; onClick: () => void; children: ComponentChildren; title?: string; label?: string; extra?: Record<string, unknown>; dropTarget?: boolean;
}) {
  return (
    <button type="button" class={`navrow ${selected ? 'sel' : ''} ${dropTarget ? 'drop-target' : ''}`} aria-current={selected ? 'page' : undefined} title={title} aria-label={label}
      onClick={onClick} {...extra}>
      {children}
    </button>
  );
}

function NavItem({ icon, title, to, count, hot, tip: hint }: { icon: string; title: string; to: string; count?: number; hot?: boolean; tip?: string }) {
  const n = count && count > 0 ? count : 0;
  return (
    <NavRow selected={nav.value === to} onClick={() => go(to)} title={hint} label={n ? `${title}, ${n}` : title}>
      <span style={{ width: 18, display: 'inline-flex', justifyContent: 'center' }}><Icon name={icon} size={14} /></span>
      <span class="grow">{title}</span>
      {n > 0 && <span class={`count ${hot ? 'badge' : ''}`}>{n}</span>}
    </NavRow>
  );
}

function PersonNavRow({ s }: { s: PersonSummary }) {
  const [targeted, setTargeted] = useState(false);
  const p = s.person;
  const pinned = ui.value.pinnedPeople.includes(p.id);
  return (
    <NavRow selected={nav.value === `person:${p.id}`} onClick={() => go(`person:${p.id}`)} dropTarget={targeted} title={tip('sidebar.person')}
      extra={{
        'data-person-id': p.id,
        onDragOver: (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; setTargeted(true); },
        onDragLeave: () => setTargeted(false),
        onDrop: (e: DragEvent) => {
          e.preventDefault();
          setTargeted(false);
          const ids = (e.dataTransfer?.getData('text/plain') ?? '').split(',').filter(Boolean);
          if (ids.length) void assignMany(ids, p.handle);
        },
        onContextMenu: (e: MouseEvent) => openContextMenu(e, [
          { label: pinned ? 'Unpin' : 'Pin to top', hint: 'Pinned people stay at the top of the sidebar.', onClick: () => togglePinnedPerson(p.id) },
          { label: 'Prep brief', hint: tip('person.brief'), onClick: () => { void api.openPersonBrief(p.id); } },
        ]),
      }}>
      <Avatar person={p} size={18} />
      <span class="grow">{p.name}</span>
      {pinned && <span class="dim" role="img" aria-label="Pinned" title="Pinned to the top of the sidebar"><Icon name="pin" size={9} /></span>}
      {s.cadenceOverdue && <span role="img" aria-label="Past 1:1 cadence" title="Past 1:1 cadence"><Dot color="var(--clay)" /></span>}
    </NavRow>
  );
}

const validVersion = (v: string) => /^\d+\.\d+\.\d+$/.test(v);

/** "v0.1.0 · What's new" with a dot while there is something unseen; switches to the update states. */
export function UpdateBadge() {
  const u = updateState.value;
  const v = info.value.version;
  if (u.status === 'ready') {
    return (
      <button type="button" class="update-badge" onClick={() => { void api.installUpdate(); }} title={tip('sidebar.updateReady')}>
        <Icon name="arrowdown" size={11} /><span>{u.version ? `Update ${u.version} ready, restart` : 'Update ready, restart'}</span><Dot color="var(--accent)" />
      </button>
    );
  }
  if (u.status === 'downloading') {
    return (
      <button type="button" class="update-badge" onClick={() => go('releases')} title={`${tip('sidebar.updating')}${u.progress != null ? ` ${Math.round(u.progress)}%.` : ''}`}>
        <Icon name="arrowdown" size={11} /><span>Downloading update…</span>
      </button>
    );
  }
  return (
    <button type="button" class="update-badge" onClick={() => go('releases')} title={tip('sidebar.whatsNew')}>
      <Icon name="sparkles" size={11} /><span>{validVersion(v) ? `v${v} · What's new` : "What's new"}</span>
      {hasUnseenRelease() && <Dot color="var(--accent)" />}
    </button>
  );
}

export function Sidebar() {
  const people = orderedPeople.value;
  const filters = ui.value.savedFilters;
  const tags = snapshot.value.tags;
  const tagsHidden = isCollapsed('sidebar.tags');
  const total = todayTotal(snapshot.value.today);
  const [filterCounts, setFilterCounts] = useState<Record<string, number>>({});
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void Promise.all(filters.map(async (q) => [q, (await api.search(q, 200)).length] as const)).then((r) => { if (live) setFilterCounts(Object.fromEntries(r)); });
    return () => { live = false; };
  }, [filters.join('\n'), snapshot.value]);

  useEffect(() => { scroller.current?.querySelector('.navrow.sel[data-person-id]')?.scrollIntoView({ block: 'center' }); }, []);

  return (
    <nav class="sidebar" aria-label="Sidebar" style={{ position: 'relative' }}>
      <div class="drag" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 34 }} />
      <button type="button" class="search-btn nodrag" onClick={() => { showSearch.value = true; }} aria-label="Search" title={tip('sidebar.search')}>
        <Icon name="search" size={12} /><span class="grow">Search</span><Kbd>⌘K</Kbd>
      </button>

      <div class="nav">
        <NavItem icon="dotted" title="Today" to="today" count={total} hot={overdueCount.value > 0} tip={tip('nav.today')} />
        <NavItem icon="scroll" title="Ledger" to="ledger" count={snapshot.value.openItems.filter((i) => i.kind === 'owe').length} tip={tip('nav.ledger')} />
        <NavItem icon="tray" title="Inbox" to="inbox" count={inboxBadge(snapshot.value.proposed.length, snapshot.value.openItems.filter((i) => i.inbox).length)} tip={tip('nav.inbox')} />
        <NavItem icon="person2" title="People" to="people" tip={tip('nav.people')} />
        <NavItem icon="moon" title="Snoozed" to="snoozed" count={snapshot.value.snoozedCount} tip={tip('nav.snoozed')} />
        <NavItem icon="circlecheck" title="Done" to="done" tip={tip('nav.done')} />
        <NavItem icon="review" title="Review" to="review" tip={tip('nav.review')} />
      </div>

      <div class="sidebar-scroll" ref={scroller}>
        <div class="sidebar-heading"><span class="caps">People</span></div>
        {people.map((s) => <PersonNavRow key={s.person.id} s={s} />)}

        {filters.length > 0 && (
          <>
            <div class="sidebar-heading"><span class="caps">Filters</span></div>
            {filters.map((q) => (
              <NavRow key={q} selected={nav.value === `filter:${q}`} onClick={() => go(`filter:${q}`)} title={tip('sidebar.filter')}
                extra={{ onContextMenu: (e: MouseEvent) => openContextMenu(e, [{ label: 'Remove filter', danger: true, onClick: () => removeFilter(q) }]) }}>
                <span style={{ width: 18, display: 'inline-flex', justifyContent: 'center' }}><Icon name="search" size={11} /></span>
                <span class="grow">{q}</span>
                <span class="count">{filterCounts[q] ?? ''}</span>
              </NavRow>
            ))}
          </>
        )}

        {tags.length > 0 && (
          <>
            <button type="button" class="sidebar-heading tags-head" aria-expanded={!tagsHidden} aria-label={`Tags, ${tagsHidden ? 'collapsed' : 'expanded'}`} title={tip('sidebar.tags')} onClick={() => toggleCollapsed('sidebar.tags')}>
              <span class={`chev ${tagsHidden ? '' : 'open'}`} style={{ display: 'inline-flex', transition: 'transform 0.15s', transform: tagsHidden ? 'none' : 'rotate(90deg)' }}><Icon name="chevron" size={9} /></span>
              <span class="caps">Tags</span>
            </button>
            {!tagsHidden && tags.map(([t, c]) => (
              <NavRow key={t} selected={nav.value === `tag:${t}`} onClick={() => go(`tag:${t}`)} title={`Open items tagged #${t}`}>
                <span style={{ width: 18, textAlign: 'center' }} aria-hidden="true">#</span>
                <span class="grow">{t}</span>
                <span class="count">{c}</span>
              </NavRow>
            ))}
          </>
        )}
      </div>

      <div class="sidebar-foot">
        <div class="row-flex gap6" title={tip('sidebar.capture')}><Icon name="keyboard" size={11} /><span>Capture</span><Kbd>{Fmt.hotkeyLabel(settings.value.hotkey)}</Kbd></div>
        <UpdateBadge />
      </div>
    </nav>
  );
}
