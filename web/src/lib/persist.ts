"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Browser storage that React can read without a hydration mismatch.
 *
 * The tempting version — `useState(null)` plus an effect that reads storage and
 * calls `setState` — renders once with the wrong answer and then corrects
 * itself. That is the "set state in an effect" pattern React now warns about,
 * and it also produces a visible flash of the empty state on every reload,
 * which is exactly what this code exists to remove.
 *
 * `useSyncExternalStore` has a server snapshot built in: SSR gets a definite
 * fallback, the client gets the real value on its first paint, and writes
 * anywhere in the app propagate through a single event.
 */

const EVENT = "blindluv:persist";

export type Area = "local" | "session";

function store(area: Area): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return area === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    // Storage can throw outright in private modes and locked-down browsers.
    return null;
  }
}

/**
 * Parsed values are memoised against the raw string they came from.
 *
 * `getSnapshot` must return a stable reference for unchanged data — parsing
 * fresh JSON on every call hands React a new object each time, which it reads
 * as a perpetual change and loops on.
 */
const cache = new Map<string, { raw: string | null; value: unknown }>();

export function readJson<T>(area: Area, key: string, fallback: T): T {
  const s = store(area);
  if (!s) return fallback;

  const raw = s.getItem(key);
  const id = `${area}:${key}`;
  const hit = cache.get(id);
  if (hit && hit.raw === raw) return hit.value as T;

  let value = fallback;
  if (raw !== null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      value = fallback;
    }
  }
  cache.set(id, { raw, value });
  return value;
}

export function writeJson(area: Area, key: string, value: unknown): void {
  const s = store(area);
  if (!s) return;
  try {
    if (value === null || value === undefined) s.removeItem(key);
    else s.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded, or storage disabled mid-session. Losing persistence is
    // not worth taking the page down for.
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * A piece of state that survives a reload.
 *
 * `key` may be null — before a wallet is connected there is nothing to scope
 * the value to, and inventing a key would mix one account's data into another's.
 * A null key reads and writes nothing.
 *
 * `fallback` must be a stable reference (a module-level constant, or a
 * primitive). A fresh object literal per render defeats the memoisation above.
 */
export function usePersisted<T>(area: Area, key: string | null, fallback: T): [T, (value: T) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => (key === null ? fallback : readJson(area, key, fallback)),
    () => fallback,
  );

  const set = useCallback(
    (next: T) => {
      if (key !== null) writeJson(area, key, next);
    },
    [area, key],
  );

  return [value, set];
}
