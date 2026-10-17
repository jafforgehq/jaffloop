// Person brief ("before you talk") and the morning brief windows.
import { useEffect, useState } from 'preact/hooks';
import type { Item, ItemKind } from '../../shared/types';
import { ItemList } from '../components/item-row';
import { Help } from '../components/info';
import { Page } from '../components/page';
import { GhostButton, SectionHeader } from '../components/ui';
import { Fmt } from '../core';
import type { HelpId } from '../help';
import { titleLine } from '../onboarding-logic';
import { api, itemsFor, openItems, person as personById, settings, snapshot, summary } from '../model';
import { useReady } from './util';

const SECTIONS: Array<[string, ItemKind, HelpId]> = [['I owe them', 'owe', 'person.owe'], ['They owe me', 'wait', 'person.wait'], ['Bring up', 'bring', 'person.bring']];
const Nothing = ({ text }: { text: string }) => <div class="dim" style={{ fontSize: 12.5, padding: 8 }}>{text}</div>;

function SaidRow({ item }: { item: Item }) {
  return (
    <div class="said-row">
      <span class="dot" style={{ background: 'var(--k-said)', marginLeft: 5 }} />
      <span class="quote grow" style={{ fontSize: 13 }}>{'“'}{item.quote ?? item.title}{'”'}</span>
      <span class="dim tnum" style={{ fontSize: 11.5 }}>{Fmt.short(item.createdAt, 'MMM d')}</span>
    </div>
  );
}

/** The same brief as plain text, for pasting into notes or a message. */
function plainText(personId: string, said: Item[]): string {
  const p = personById(personId);
  if (!p) return '';
  const out = [`Brief: ${p.name}`];
  if (p.title) out.push(`Position: ${p.title}`);
  const s = summary(p.id);
  if (s) out.push(`Last 1:1: ${s.daysSinceLast != null ? `${s.daysSinceLast} days ago` : 'never'}${p.cadenceDays != null ? ` (cadence: every ${p.cadenceDays} days)` : ''}`);
  if (p.notes) out.push('', 'Notes:', p.notes);
  for (const [title, k] of SECTIONS) {
    const items = itemsFor(p.id, k);
    out.push('', `${title}:`, ...(items.length ? items.map((i) => { const d = Fmt.due(i); return `- ${i.title}${d ? ` (${d})` : ''}`; }) : ['- nothing']));
  }
  const recent = said.slice(0, 5);
  if (recent.length) out.push('', 'Recently said:', ...recent.map((i) => `- "${i.quote ?? i.title}" (${Fmt.short(i.createdAt, 'd MMM')})`));
  return out.join('\n');
}

export function PersonBriefWindow() {
  useReady();
  const id = api.params.personId ?? '';
  const [said, setSaid] = useState<Item[]>([]);
  const [copied, setCopied] = useState(false);
  const stamp = snapshot.value.now;
  useEffect(() => { void api.saidLog(id).then(setSaid); }, [id, stamp]);

  const p = personById(id);
  if (!p) return <div class="main" style={{ height: '100%' }}><Page title="Brief"><Nothing text="This person no longer exists." /></Page></div>;
  const recent = said.slice(0, 5);
  const copy = async () => { await api.copyText(plainText(id, said)); setCopied(true); setTimeout(() => setCopied(false), 1800); };

  return (
    <div class="main" style={{ height: '100%' }}>
      <Page title={`Brief: ${p.name}`} subtitle={p.title ? `${titleLine(p)} · before you talk` : 'Before you talk'} header={<div class="row-flex" style={{ paddingTop: 12 }}><GhostButton onClick={() => void copy()}>{copied ? 'Copied' : 'Copy as text'}</GhostButton><Help id="brief.copy" /></div>} help="page.personBrief">
        {p.notes && (
          <div class="section">
            <SectionHeader title="Notes" help="brief.notes" />
            <div class="brief-notes">{p.notes}</div>
          </div>
        )}
        {SECTIONS.map(([title, k, help]) => {
          const items = itemsFor(p.id, k);
          return (
            <div key={k} class="section">
              <SectionHeader title={title} count={items.length} help={help} />
              {items.length === 0 && <Nothing text="Nothing." />}
              <ItemList items={items} showPerson={false} />
            </div>
          );
        })}
        <div class="section">
          <SectionHeader title="Recently said" count={recent.length} help="brief.said" />
          {recent.map((i) => <SaidRow key={i.id} item={i} />)}
        </div>
      </Page>
    </div>
  );
}

export function MorningBriefWindow() {
  useReady();
  const now = Date.now();
  const t = new Date(now);
  const endOfDay = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1).getTime();
  const open = openItems.value;
  const due = open.filter((i) => i.kind === 'owe' && i.dueAt != null && i.dueAt < endOfDay);
  const waits = open.filter((i) => i.kind === 'wait' && (Fmt.isStaleWait(i, now, settings.value) || Fmt.isOverdue(i, now)));
  return (
    <div class="main" style={{ height: '100%' }}>
      <Page title="Good morning" help="page.morningBrief" subtitle={Fmt.short(now, 'EEEE, d MMMM')}>
        <div class="section">
          <SectionHeader title="You owe, due today or earlier" count={due.length} help="brief.owed" />
          <ItemList items={due} />
        </div>
        <div class="section">
          <SectionHeader title="Owed to you, stale or late" count={waits.length} help="brief.waits" />
          <ItemList items={waits} />
        </div>
        {due.length === 0 && waits.length === 0 && <Nothing text="Clear start." />}
      </Page>
    </div>
  );
}
