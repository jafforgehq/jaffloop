// Inbox: captures with no person and no date, triaged with the keys p d t w x. Ported from MainView.swift InboxView.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Item } from '../../shared/types';
import { AllClosed } from '../components/all-closed';
import { ItemRow } from '../components/item-row';
import { Help } from '../components/info';
import { LinkedTitle } from '../components/linked-title';
import { Page } from '../components/page';
import { PersonPicker } from '../components/person-picker';
import { Avatar, GhostButton, KindLabel, Kbd, Popover, PrimaryButton, SectionHeader } from '../components/ui';
import { Fmt } from '../core';
import { tip } from '../help';
import { useItemKeys } from '../hooks/use-item-keys';
import { acceptOne, acceptProposed, assign, dismissOne, dismissProposed, drop, inboxItems, person, proposedItems, selectedItemId } from '../model';
import { neighbour, triageDue } from '../ui-logic';

/** One of Claude's proposals: nothing but Accept and Dismiss (keys a and x) until you decide. */
function ProposalRow({ item, index }: { item: Item; index: number }) {
  const p = person(item.personId);
  const due = Fmt.due(item, Date.now());
  const selected = selectedItemId.value === item.id;
  return (
    <div class={`row proposal ${selected ? 'selected' : ''}`} role="option" aria-selected={selected} data-item-id={item.id} data-kind={item.kind} data-testid="proposal"
      style={{ animationDelay: `${Math.min(index, 14) * 24}ms` }}
      onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) selectedItemId.value = item.id; }}>
      <span class="c-kind"><KindLabel kind={item.kind} /></span>
      <div class="title-cell">
        <div class="row-title" title={item.title}><LinkedTitle text={item.title} /></div>
        {item.body && <div class="row-body">{item.body}</div>}
      </div>
      <span class="c-person">{p && <span class="person-hit"><Avatar person={p} size={16} /><span class="ellipsis">{p.name.split(/\s+/)[0]}</span></span>}</span>
      {item.sourceLabel && <span class="chip mini-src" title={item.externalId ? `id: ${item.externalId}` : undefined}>{item.sourceLabel}</span>}
      <span class="c-date">{due}</span>
      <span class="row-flex gap6">
        <PrimaryButton label={`Accept ${item.title}`} title={tip('inbox.accept')} onClick={() => void acceptOne(item)}>Accept</PrimaryButton>
        <GhostButton label={`Dismiss ${item.title}`} title={tip('inbox.dismiss')} onClick={() => void dismissOne(item)}>Dismiss</GhostButton>
      </span>
    </div>
  );
}

export function InboxPage() {
  const items = inboxItems.value;
  const proposals = proposedItems.value;
  const all = [...proposals, ...items];
  const [pick, setPick] = useState(false);
  const pickBtn = useRef<HTMLButtonElement>(null);

  const triage = (key: string, i: Item, list: Item[]): boolean => {
    const moveOn = () => { selectedItemId.value = neighbour(i.id, list.map((x) => x.id)); };
    if (i.proposed) {
      if (key === 'a') { moveOn(); void acceptOne(i); return true; }
      if (key === 'x') { moveOn(); void dismissOne(i); return true; }
      return false;
    }
    if (key === 'p') { setPick(true); return true; }
    if (key === 'x') { moveOn(); void drop(i); return true; }
    const due = triageDue(key, Date.now());
    if (due === undefined) return false;
    moveOn();
    void assign(i, null, due);
    return true;
  };
  useItemKeys(all, { triage });
  useEffect(() => { if (!all.some((i) => i.id === selectedItemId.peek())) selectedItemId.value = all[0]?.id ?? null; }, []);
  useEffect(() => { if (pick && !items.some((i) => i.id === selectedItemId.value)) setPick(false); });

  const action = (title: string, key: string, hint: string, run: () => void, ref?: preact.RefObject<HTMLButtonElement>) => (
    <button type="button" class="triage-btn" ref={ref} title={hint} onClick={run}>{title} <Kbd>{key}</Kbd></button>
  );

  return (
    <Page title="Inbox" help="page.inbox" subtitle="Captures with no person and no date. Assign one or drop the item.">
      {proposals.length > 0 && (
        <div class="section proposals" data-testid="proposals">
          <SectionHeader title="Claude added these" count={proposals.length} help="inbox.proposals">
            <GhostButton onClick={() => void acceptProposed(proposals.map((i) => i.id))}>Accept all</GhostButton>
            <Help id="inbox.acceptAll" />
            <GhostButton onClick={() => void dismissProposed(proposals.map((i) => i.id))}>Dismiss all</GhostButton>
            <Help id="inbox.dismissAll" />
          </SectionHeader>
          <div class="rows" role="listbox" aria-label="Claude added these">
            {proposals.map((i, idx) => <ProposalRow key={i.id} item={i} index={idx} />)}
          </div>
        </div>
      )}
      {items.length === 0 && proposals.length === 0 && <AllClosed title="Inbox zero" message="Captures with no person and no date land here." />}
      <div class="rows" role="listbox" aria-label="Inbox">
        {items.map((i, idx) => (
          <div key={i.id}>
            <ItemRow item={i} index={idx} showPerson={false} />
            {selectedItemId.value === i.id && (
              <div class="triage-bar">
                {action('Person', 'p', tip('inbox.person'), () => setPick(true), pickBtn)}
                {action('Today', 'd', tip('inbox.today'), () => triage('d', i, items))}
                {action('Tomorrow', 't', tip('inbox.tomorrow'), () => triage('t', i, items))}
                {action('Next week', 'w', tip('inbox.nextWeek'), () => triage('w', i, items))}
                {action('Drop', 'x', tip('inbox.drop'), () => triage('x', i, items))}
                <Help id="inbox.triage" />
                <Popover anchor={pickBtn.current} open={pick} onClose={() => setPick(false)} width={244}>
                  <PersonPicker onPick={(h) => { setPick(false); void assign(i, h, null); }} />
                </Popover>
              </div>
            )}
          </div>
        ))}
      </div>
    </Page>
  );
}
