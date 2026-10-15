import type { Person } from '../../shared/types';
import { useFetched } from '../hooks/use-fetched';
import { api } from '../model';
import { streakText } from '../reports-logic';
import { Icon } from './icons';
import { Chip } from './ui';

/** "On cadence 9 weeks in a row"; renders nothing at zero or without a cadence. */
export function StreakChip({ person }: { person: Person }) {
  const weeks = useFetched(() => api.onTimeStreak(person.id), [person.id, person.cadenceDays]);
  const text = streakText(weeks);
  if (!text) return null;
  return <span data-testid="streak"><Chip title="Weeks in a row in which the gap between 1:1s stayed within your cadence"><Icon name="check" size={11} />{text}</Chip></span>;
}
