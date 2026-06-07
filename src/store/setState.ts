import type { SetStateAction } from "react";

/**
 * Resolve a React-style `SetStateAction` (value or updater fn) against the current
 * value. Lets store setters be typed as `Dispatch<SetStateAction<T>>` so they are
 * drop-in replacements for the `useState` setters the hooks were written against
 * (some call the updater form, e.g. `setSelectedTaskId(cur => ...)`).
 */
export function applyUpdate<T>(value: SetStateAction<T>, current: T): T {
  return typeof value === "function" ? (value as (prev: T) => T)(current) : value;
}
