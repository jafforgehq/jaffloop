import type { Person } from '../../shared/types';
import { useFetched } from '../hooks/use-fetched';
import { api } from '../model';
import { streakText } from '../reports-logic';
import { Icon } from './icons';
import { Help } from './info';
import { Chip } from './ui';

/** "On cadence 9 weeks in a row"; renders nothing at zero or without a cadence. */
export function StreakChip({ person }: { person: Person }) {
  const weeks = useFetched(() => api.onTimeStreak(person.id), [person.id, person.cadenceDays]);
  const text = streakText(weeks);
  if (!text) return null;
  return <span data-testid="streak" class="row-flex"><Chip><Icon name="check" size={11} />{text}</Chip><Help id="person.streak" size={12} /></span>;
}
