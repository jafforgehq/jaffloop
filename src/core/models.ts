// Constructors and small helpers for the data types (pure).
import type { Interaction, Item, ItemKind, ItemSource, ItemStatus, Person, Relation } from '../shared/types';

export function newId(): string {
  return globalThis.crypto.randomUUID().toUpperCase();
}

export interface NewItem {
  kind: ItemKind;
  title: string;
  id?: string;
  body?: string | null;
  quote?: string | null;
  personId?: string | null;
  status?: ItemStatus;
  dueAt?: number | null;
  dueHasTime?: boolean;
  remindAt?: number | null;
  snoozedUntil?: number | null;
  snoozeCount?: number;
  recurRule?: string | null;
  pinned?: boolean;
  inbox?: boolean;
  source?: ItemSource;
  now?: number;
}

/** Same defaults as the Swift `Item.init`. */
export function newItem(i: NewItem): Item {
  const now = i.now ?? Date.now();
  return {
    id: i.id ?? newId(), kind: i.kind, title: i.title, body: i.body ?? null, quote: i.quote ?? null,
    personId: i.personId ?? null, status: i.status ?? 'open', dueAt: i.dueAt ?? null, dueHasTime: i.dueHasTime ?? false,
    remindAt: i.remindAt ?? null, snoozedUntil: i.snoozedUntil ?? null, snoozeCount: i.snoozeCount ?? 0,
    recurRule: i.recurRule ?? null, pinned: i.pinned ?? false, inbox: i.inbox ?? false, source: i.source ?? 'hotkey',
    createdAt: now, updatedAt: now, completedAt: null, lastTouchedAt: now,
  };
}

export interface NewPerson {
  handle: string;
  name: string;
  id?: string;
  relation?: Relation;
  cadenceDays?: number | null;
  matchEmails?: string;
  hiddenFromClaude?: boolean;
  archived?: boolean;
  notes?: string;
  startDate?: string | null;
  birthday?: string | null;
}

export function newPerson(p: NewPerson): Person {
  return {
    id: p.id ?? newId(), handle: p.handle, name: p.name, relation: p.relation ?? 'other', cadenceDays: p.cadenceDays ?? null,
    matchEmails: p.matchEmails ?? '', hiddenFromClaude: p.hiddenFromClaude ?? false, archived: p.archived ?? false, notes: p.notes ?? '',
    startDate: p.startDate ?? null, birthday: p.birthday ?? null,
  };
}

export function newInteraction(x: Pick<Interaction, 'personId'> & Partial<Interaction>): Interaction {
  return {
    id: x.id ?? newId(), personId: x.personId, occurredAt: x.occurredAt ?? Date.now(), kind: x.kind ?? '1on1',
    calendarEventId: x.calendarEventId ?? null, notes: x.notes ?? null,
  };
}

/** "Sara Lee" -> "SL", "Sara" -> "SA". */
export function personInitials(p: Pick<Person, 'name'>): string {
  const parts = p.name.split(' ').filter(Boolean).map((s) => [...s]);
  const s = parts.length > 1 ? parts[0]!.slice(0, 1).join('') + parts[1]!.slice(0, 1).join('') : [...p.name].slice(0, 2).join('');
  return s.toUpperCase();
}

export function personEmails(p: Pick<Person, 'matchEmails'>): string[] {
  return p.matchEmails.split(',').map((e) => e.trim().toLowerCase()).filter((e) => e !== '');
}

/** "sara.lee" -> "Sara Lee" (what the Store uses when it creates a person from a handle). */
export function nameFromHandle(handle: string): string {
  return handle.toLowerCase().split(/[._-]/).filter(Boolean).map((w) => { const c = [...w]; return c[0]!.toUpperCase() + c.slice(1).join(''); }).join(' ');
}
