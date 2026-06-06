/** Immutable helpers for updating lists of `{ id }` records held in React state. */

/** Replace the item sharing `updated.id`; returns an unchanged list if none match. */
export function replaceById<T extends { id: number }>(list: readonly T[], updated: T): T[] {
  return list.map((item) => (item.id === updated.id ? updated : item));
}

/** Replace the item sharing `item.id`, or append it when absent. */
export function upsertById<T extends { id: number }>(list: readonly T[], item: T): T[] {
  return list.some((existing) => existing.id === item.id) ? replaceById(list, item) : [...list, item];
}

/** Replace the item sharing `item.id`, or prepend it (newest-first) when absent. */
export function upsertNewestById<T extends { id: number }>(list: readonly T[], item: T): T[] {
  return list.some((existing) => existing.id === item.id) ? replaceById(list, item) : [item, ...list];
}
