import { describe, expect, it } from 'vitest';
import { monthRange } from './list-query.js';

describe('monthRange', () => {
  it('returns the first day of this month and of the next', () => {
    expect(monthRange('2026-09-03')).toEqual({ start: '2026-09-01', next: '2026-10-01' });
    expect(monthRange('2026-12-31')).toEqual({ start: '2026-12-01', next: '2027-01-01' });
  });
});
