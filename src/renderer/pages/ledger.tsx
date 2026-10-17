// Promise ledger: everything you owe, grouped by person (earliest due first). Ported from MainView.swift LedgerView.
import { useState } from 'preact/hooks';
import { AllClosed } from '../components/all-closed';
import { ItemList } from '../components/item-row';
import { Help } from '../components/info';
import { Page } from '../components/page';
import { Avatar, Segmented } from '../components/ui';
import { Fmt } from '../core';
import { useItemKeys } from '../hooks/use-item-keys';
import { ledgerItems, person } from '../model';
import { ledgerGroups } from '../ui-logic';

export function LedgerPage() {
  const [overdueOnly, setOverdueOnly] = useState(false);
  const now = Date.now();
  const g = ledgerGroups(ledgerItems.value, overdueOnly, (i) => Fmt.isOverdue(i, now));
  useItemKeys(g.flat);
  const header = (
    <div class="row-flex" style={{ marginTop: 14 }}>
      <Segmented<'all' | 'overdue'> label="Show" value={overdueOnly ? 'overdue' : 'all'} onChange={(v) => setOverdueOnly(v === 'overdue')}
        options={[{ value: 'all', label: 'All' }, { value: 'overdue', label: 'Overdue' }]} />
      <Help id="ledger.show" />
    </div>
  );
  return (
    <Page title="Promise ledger" help="page.ledger" subtitle={`${g.items.length} open · everything you have promised`} header={header}>
      {g.items.length === 0 && <AllClosed title="No open promises" message="When you say you will do something, capture it: owe @sara review RFC fri." />}
      {g.order.map((pid) => {
        const p = person(pid || null);
        const list = g.groups.get(pid)!;
        return (
          <div key={pid}>
            <div class="ledger-head">
              {p ? <><Avatar person={p} size={20} /><span style={{ fontWeight: 500 }}>{p.name}</span></> : <span class="dim" style={{ fontWeight: 500 }}>No person</span>}
              <span class="dim tnum" style={{ fontSize: 11.5 }}>{list.length}</span>
              <span class="hairline grow" />
            </div>
            <ItemList items={list} showPerson={false} />
          </div>
        );
      })}
    </Page>
  );
}
