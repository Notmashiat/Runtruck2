import { describe, expect, it } from 'vitest';
import { loadNumberFromParam } from '@/lib/api/loads';

// The /app/loads/:loadNumber segment (docs/api/loads.md §8.2.1): only an exact formatted
// load number is looked up; anything else shows the first board load, as Runtruck1 did.
describe('loadNumberFromParam', () => {
  it('accepts exactly a formatted load number', () => {
    expect(loadNumberFromParam('L-40218')).toBe(40218);
    expect(loadNumberFromParam('L%2D40218')).toBe(40218);
    expect(loadNumberFromParam('L-1')).toBe(1);
  });

  it('falls back for every other segment (D6)', () => {
    for (const segment of ['l-40218', 'L-040218', '40218', ' L-40218', 'L-40218 ', 'L-', 'L-0', 'L-00', 'L-1234567890', '%E0%A4%A', 'nonsense']) {
      expect(loadNumberFromParam(segment)).toBeNull();
    }
  });
});
