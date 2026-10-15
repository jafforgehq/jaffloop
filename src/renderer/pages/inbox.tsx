// Inbox: captures with no person and no date, triaged with the keys p d t w x. Ported from MainView.swift InboxView.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Item } from '../../shared/types';
import { AllClosed } from '../components/all-closed';
import { ItemRow } from '../components/item-row';
import { Page } from '../components/page';
import { PersonPicker } from '../components/person-picker';
import { Kbd, Popover } from '../components/ui';
import { useItemKeys } from '../hooks/use-item-keys';
import { assign, drop, inboxItems, selectedItemId } from '../model';
import { neighbour, triageDue } from '../ui-logic';

export function InboxPage() {
  const items = inboxItems.value;
  const [pick, setPick] = useState(false);
  const pickBtn = useRef<HTMLButtonElement>(null);

  const triage = (key: string, i: Item, list: Item[]): boolean => {
    const moveOn = () => { selectedItemId.value = neighbour(i.id, list.map((x) => x.id)); };
    if (key === 'p') { setPick(true); return true; }
    if (key === 'x') { moveOn(); void drop(i); return true; }
    const due = triageDue(key, Date.now());
    if (due === undefined) return false;
    moveOn();
    void assign(i, null, due);
    return true;
  };
  useItemKeys(items, { triage });
  useEffect(() => { if (!items.some((i) => i.id === selectedItemId.peek())) selectedItemId.value = items[0]?.id ?? null; }, []);
  useEffect(() => { if (pick && !items.some((i) => i.id === selectedItemId.value)) setPick(false); });

  const action = (title: string, key: string, run: () => void, ref?: preact.RefObject<HTMLButtonElement>) => (
    <button type="button" class="triage-btn" ref={ref} onClick={run}>{title} <Kbd>{key}</Kbd></button>
  );

  return (
    <Page title="Inbox" subtitle="Captures with no person and no date. Assign one or drop the item.">
      {items.length === 0 && <AllClosed title="Inbox zero" message="Captures with no person and no date land here." />}
      <div class="rows" role="listbox" aria-label="Inbox">
        {items.map((i, idx) => (
          <div key={i.id}>
            <ItemRow item={i} index={idx} showPerson={false} />
            {selectedItemId.value === i.id && (
              <div class="triage-bar">
                {action('Person', 'p', () => setPick(true), pickBtn)}
                {action('Today', 'd', () => triage('d', i, items))}
                {action('Tomorrow', 't', () => triage('t', i, items))}
                {action('Next week', 'w', () => triage('w', i, items))}
                {action('Drop', 'x', () => triage('x', i, items))}
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
