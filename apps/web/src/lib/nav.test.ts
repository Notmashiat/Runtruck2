import { describe, expect, it } from 'vitest';
import { homePath, parseAppPath } from './nav';
import { matchesQuery } from './search';

describe('matchesQuery (Runtruck1 lib/search.ts parity)', () => {
  const row = { id: 'L-40218', route: 'Fresno, CA → Reno, NV', miles: 478, ref: 'PO 88-41207', tagClass: 'tag-accent', tone: 'blue' };

  it('matches any string or number field, including hidden ones, case-insensitively', () => {
    expect(matchesQuery(row, '  fresno ')).toBe(true);
    expect(matchesQuery(row, '478')).toBe(true);
    expect(matchesQuery(row, 'po 88')).toBe(true);
  });

  it('ignores presentation keys and matches everything for a blank query', () => {
    expect(matchesQuery(row, 'tag-accent')).toBe(false);
    expect(matchesQuery(row, 'blue')).toBe(false);
    expect(matchesQuery(row, '   ')).toBe(true);
  });
});

describe('navigation helpers', () => {
  it('parses sections case-insensitively', () => {
    expect(parseAppPath('/app/Fleet/Drivers')).toEqual({ view: 'fleet', segments: ['', 'app', 'fleet', 'drivers'] });
    expect(parseAppPath('/app').view).toBe('dashboard');
  });

  it('lands members on the first section they may open', () => {
    expect(homePath(['dashboard.view', 'loads.view'])).toBe('/app/dashboard');
    expect(homePath(['trucks.view', 'maintenance.view'])).toBe('/app/safety');
    expect(homePath([])).toBe('/app/dashboard');
  });
});
