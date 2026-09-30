import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstanceStore } from './persist';

// Runtruck1's usePersisted semantics per mounted hook: storage is read once, later writes by
// other tabs do not change it, every change is written back, and blocked storage falls back
// to memory for that mount only.

const KEY = 'runtruck-planner-prefs';
interface Prefs {
  view: string;
  hidden: string[];
}
const FALLBACK: Prefs = { view: 'Week', hidden: [] };
const revive = (raw: unknown): Prefs | null => (raw && typeof raw === 'object' ? { ...FALLBACK, ...(raw as Partial<Prefs>) } : null);

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => {
      data.clear();
    },
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => {
      data.delete(k);
    },
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

describe('createInstanceStore (usePersisted)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the stored value once and ignores later writes by another tab', () => {
    localStorage.setItem(KEY, JSON.stringify({ view: 'Month' }));
    const tabB = createInstanceStore(KEY, FALLBACK, revive);
    expect(tabB.get()).toEqual({ view: 'Month', hidden: [] });

    // Tab A writes; tab B's open Planner keeps what it read.
    localStorage.setItem(KEY, JSON.stringify({ view: 'Day', hidden: ['meeting'] }));
    expect(tabB.get()).toEqual({ view: 'Month', hidden: [] });

    // Tab B's own change overwrites storage with its whole state, as in Runtruck1.
    tabB.set({ view: 'Month', hidden: ['maintenance'] });
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual({ view: 'Month', hidden: ['maintenance'] });
  });

  it('a new mount reads what is stored now, even after this tab wrote', () => {
    const first = createInstanceStore(KEY, FALLBACK, revive);
    first.set({ view: 'Month', hidden: ['meeting'] });
    localStorage.setItem(KEY, JSON.stringify({ view: 'Week', hidden: ['meeting', 'maintenance'] }));
    const remount = createInstanceStore(KEY, FALLBACK, revive);
    expect(remount.get()).toEqual({ view: 'Week', hidden: ['meeting', 'maintenance'] });
  });

  it('falls back on missing or unreadable values', () => {
    expect(createInstanceStore(KEY, FALLBACK, revive).get()).toBe(FALLBACK);
    localStorage.setItem(KEY, '{not json');
    expect(createInstanceStore(KEY, FALLBACK, revive).get()).toBe(FALLBACK);
    localStorage.setItem(KEY, '42');
    expect(createInstanceStore(KEY, FALLBACK, revive).get()).toBe(FALLBACK);
  });

  it('keeps working in memory for this mount when storage is blocked', () => {
    const blocked = () => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked });
    const store = createInstanceStore(KEY, FALLBACK, revive);
    expect(store.get()).toBe(FALLBACK);
    const seen = vi.fn();
    store.subscribe(seen);
    store.set({ view: 'Day', hidden: [] });
    expect(store.get()).toEqual({ view: 'Day', hidden: [] });
    expect(seen).toHaveBeenCalledTimes(1);
    // The next mount starts from the fallback again, as Runtruck1's useState did.
    expect(createInstanceStore(KEY, FALLBACK, revive).get()).toBe(FALLBACK);
  });

  it('returns the same object until it changes (a stable useSyncExternalStore snapshot)', () => {
    localStorage.setItem(KEY, JSON.stringify({ view: 'Day' }));
    const store = createInstanceStore(KEY, FALLBACK, revive);
    expect(store.get()).toBe(store.get());
  });
});
