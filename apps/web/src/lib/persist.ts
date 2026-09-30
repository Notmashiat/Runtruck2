'use client';

import { type Dispatch, type SetStateAction, useCallback, useSyncExternalStore } from 'react';

// Runtruck1 lib/persist.ts `usePersisted`, for per-device VIEW PREFERENCES only (the Planner's
// `runtruck-planner-prefs`, docs/01 D8): business data lives in the API (architecture Rule 1).
//
// Runtruck1 read localStorage in the useState initializer, which would make the first client
// render differ from the server's (a hydration mismatch, port spec §14.3). Here the value is an
// external store: the server and the hydration render use `fallback`, and React re-renders with
// the stored value right after hydration. Writes go to localStorage (errors swallowed) and to
// an in-memory copy, so the page keeps working when storage is blocked, as in Runtruck1.

interface Entry {
  raw: string | null;
  value: unknown;
}

const memory = new Map<string, unknown>();
const cache = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function notify(key: string): void {
  listeners.get(key)?.forEach((listener) => {
    listener();
  });
}

export function usePersisted<T>(
  key: string,
  fallback: T,
  revive: (raw: unknown) => T | null = (raw) => raw as T,
): readonly [T, Dispatch<SetStateAction<T>>] {
  // `fallback` and `revive` should be stable (module constants), as in Runtruck1's callers.
  const subscribe = useCallback(
    (listener: () => void) => {
      const set = listeners.get(key) ?? new Set();
      set.add(listener);
      listeners.set(key, set);
      const onStorage = (e: StorageEvent) => {
        if (e.key === key) listener();
      };
      window.addEventListener('storage', onStorage);
      return () => {
        set.delete(listener);
        window.removeEventListener('storage', onStorage);
      };
    },
    [key],
  );

  const getSnapshot = useCallback((): T => {
    if (memory.has(key)) return memory.get(key) as T;
    const raw = readRaw(key);
    const hit = cache.get(key);
    if (hit && hit.raw === raw) return hit.value as T;
    let value: T = fallback;
    if (raw !== null) {
      try {
        value = revive(JSON.parse(raw)) ?? fallback;
      } catch {
        value = fallback;
      }
    }
    cache.set(key, { raw, value });
    return value;
  }, [key, fallback, revive]);

  const getServerSnapshot = useCallback((): T => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (action) => {
      const current = getSnapshot();
      const next = typeof action === 'function' ? (action as (prev: T) => T)(current) : action;
      memory.set(key, next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage full or blocked: keep working in memory.
      }
      notify(key);
    },
    [key, getSnapshot],
  );

  return [value, setValue] as const;
}
