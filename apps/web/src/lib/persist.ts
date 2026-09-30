'use client';

import { type Dispatch, type SetStateAction, useCallback, useState, useSyncExternalStore } from 'react';

// Runtruck1 lib/persist.ts `usePersisted`, for per-device VIEW PREFERENCES only (the Planner's
// `runtruck-planner-prefs`, docs/01 D8): business data lives in the API (architecture Rule 1).
//
// Runtruck1's semantics: each mounted hook reads localStorage ONCE, then keeps the value in its
// own state and writes every change back. Another tab's writes never change an open screen;
// they show on its next mount. When storage is blocked the value lives in that mounted hook
// only (it starts from `fallback` again on the next mount).
//
// Runtruck1 read storage in the useState initializer, which would make the first client render
// differ from the server's (a hydration mismatch, port spec §14.3). So the value sits in a store
// owned by the hook instance: the server and the hydration render use `fallback`, and React
// re-renders with the stored value right after hydration. A mount after hydration (client-side
// navigation) reads storage in its first render, as Runtruck1 did.

export interface InstanceStore<T> {
  get: () => T;
  set: (next: T) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createInstanceStore<T>(key: string, fallback: T, revive: (raw: unknown) => T | null): InstanceStore<T> {
  let read = false;
  let value = fallback;
  const listeners = new Set<() => void>();
  const get = (): T => {
    if (!read) {
      read = true;
      try {
        const raw = localStorage.getItem(key);
        value = raw === null ? fallback : (revive(JSON.parse(raw)) ?? fallback);
      } catch {
        value = fallback;
      }
    }
    return value;
  };
  return {
    get,
    set: (next) => {
      read = true;
      value = next;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage full or blocked: keep working in memory.
      }
      listeners.forEach((listener) => {
        listener();
      });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function usePersisted<T>(
  key: string,
  fallback: T,
  revive: (raw: unknown) => T | null = (raw) => raw as T,
): readonly [T, Dispatch<SetStateAction<T>>] {
  // `key`, `fallback` and `revive` are read once per mount (module constants in every caller).
  const [store] = useState(() => createInstanceStore(key, fallback, revive));
  const getServerSnapshot = useCallback((): T => fallback, [fallback]);
  const value = useSyncExternalStore(store.subscribe, store.get, getServerSnapshot);

  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (action) => {
      const current = store.get();
      store.set(typeof action === 'function' ? (action as (prev: T) => T)(current) : action);
    },
    [store],
  );

  return [value, setValue] as const;
}
