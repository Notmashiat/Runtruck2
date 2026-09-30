import { describe, expect, it } from 'vitest';
import { toFacilitySearchRow } from './facilities.js';

describe('facilities view-model', () => {
  it('projects the searchable fields and keeps the id out of reach of search', () => {
    const row = toFacilitySearchRow({
      id: 'f',
      name: 'Reno Grocers DC',
      kind: 'consignee',
      addressLine1: '1855 E Greg St',
      city: 'Sparks',
      state: 'NV',
      postalCode: null,
      timezone: 'America/Los_Angeles',
      marketCity: 'Reno',
      marketState: 'NV',
      marketShort: null,
    });
    expect(row).toEqual({
      name: 'Reno Grocers DC',
      addressLine1: '1855 E Greg St',
      city: 'Sparks',
      state: 'NV',
      postalCode: null,
      ref: { id: 'f' },
    });
  });
});
