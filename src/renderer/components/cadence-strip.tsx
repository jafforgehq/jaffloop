import type { Person } from '../../shared/types';
import { Fmt } from '../core';
import { useFetched } from '../hooks/use-fetched';
import { api } from '../model';

/** Twelve dots, one per week, filled where a 1:1 happened. */
export function CadenceStripView({ person }: { person: Person }) {
  const list = useFetched(() => api.interactions(person.id, 80), [person.id]);
  const weeks = list ? Fmt.cadenceWeeks(list.map((i) => i.occurredAt)) : Array<boolean>(12).fill(false);
  return (
    <div class="cadence-strip" role="img" aria-label={`1:1s in the last 12 weeks: ${weeks.filter(Boolean).length}`}>
      <span class="cap-sm">12 weeks</span>
      {weeks.map((met, i) => <span key={i} class={`wk ${met ? 'met' : ''}`} title={met ? '1:1 that week' : 'No 1:1 that week'} />)}
      <span class="dim" style={{ fontSize: 11, marginLeft: 2 }}>now</span>
    </div>
  );
}
