// Pure helpers for adding people (onboarding wizard, People dialog) and for the proposed-items UI. No DOM, no signals.
import type { Person, Relation } from '../shared/types';

export const CADENCE_PRESETS = [7, 14, 30] as const;
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The handle the main process derives from a typed name (same rule as ipc addPerson): "Sara Lindqvist" -> "sara.lindqvist". */
export const handleFromName = (name: string): string => name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join('.');

export interface PersonDraft {
  name: string;
  title: string;
  relation: Relation;
  /** days between 1:1s; 0 = none */
  cadence: number;
  /** 1..12, 0 = not set */
  birthMonth: number;
  /** 1..31, 0 = not set */
  birthDay: number;
  /** YYYY-MM-DD or '' */
  startDate: string;
  emails: string;
}

export const emptyDraft = (): PersonDraft => ({ name: '', title: '', relation: 'report', cadence: 14, birthMonth: 0, birthDay: 0, startDate: '', emails: '' });

/** days in a month; February allows the 29th (a birthday has no year) */
export const daysInMonth = (month: number): number => (month === 2 ? 29 : [4, 6, 9, 11].includes(month) ? 30 : 31);

/** 'MM-DD' from a month and day; null unless both are set and the day exists in that month. */
export function birthdayFrom(month: number, day: number): string | null {
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= daysInMonth(month))) return null;
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The inverse of birthdayFrom, for filling the form from a stored 'MM-DD' (or 'YYYY-MM-DD'). */
export function monthDayOf(birthday: string | null): { month: number; day: number } {
  const m = birthday ? /^(?:\d{4}-)?(\d{2})-(\d{2})$/.exec(birthday) : null;
  return m ? { month: Number(m[1]), day: Number(m[2]) } : { month: 0, day: 0 };
}

/** Why the draft cannot be saved (shown inline), or null. `people` are the ones already in the list. */
export function draftError(d: PersonDraft, people: ReadonlyArray<Pick<Person, 'handle' | 'name'>>): string | null {
  const name = d.name.trim();
  if (!name) return 'Add a name.';
  const handle = handleFromName(name);
  if (!handle) return 'Use letters or numbers in the name.';
  const same = people.find((p) => p.handle === handle);
  if (same) return `${same.name} is already in your list`;
  if ((d.birthMonth > 0) !== (d.birthDay > 0) || (d.birthMonth > 0 && birthdayFrom(d.birthMonth, d.birthDay) == null)) return 'Pick both a month and a day for the birthday, or neither.';
  return null;
}

/** The person fields a draft sets (everything but id, handle and the Claude/archive flags). */
export function draftFields(d: PersonDraft): Pick<Person, 'name' | 'title' | 'relation' | 'cadenceDays' | 'birthday' | 'startDate' | 'matchEmails'> {
  return {
    name: d.name.trim(),
    title: d.title.trim(),
    relation: d.relation,
    cadenceDays: d.cadence > 0 ? Math.min(90, Math.round(d.cadence)) : null,
    birthday: birthdayFrom(d.birthMonth, d.birthDay),
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(d.startDate) ? d.startDate : null,
    matchEmails: d.emails.split(',').map((e) => e.trim()).filter(Boolean).join(', '),
  };
}

/** "Staff engineer · report"; just the relation when there is no position. */
export const titleLine = (p: Pick<Person, 'title' | 'relation'>): string => (p.title.trim() ? `${p.title.trim()} · ${p.relation}` : p.relation);

// ---------------------------------------------------------------- proposed items

export const reviewCardText = (n: number): string => `Claude added ${n} ${n === 1 ? 'item' : 'items'} for you to review`;

/** The sidebar Inbox badge: proposals plus the normal inbox. */
export const inboxBadge = (proposed: number, inbox: number): number => proposed + inbox;

export const proposedToast = (verb: 'Accepted' | 'Dismissed', n: number, title?: string): string => `${verb} · ${n === 1 && title ? title : `${n} items`}`;
