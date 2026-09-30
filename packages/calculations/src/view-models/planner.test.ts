import type { PlannerEventDto } from '@runtruck/types';
import { describe, expect, it } from 'vitest';
import {
  firstUnusedPlannerTone,
  PLANNER_TONES,
  plannerDeleteCodeConfirm,
  plannerEventMatches,
  plannerRelatedLoadText,
  plannerSearchRow,
  plannerStopValues,
  plannerValueOf,
  toPlannerCategory,
  toPlannerEventVm,
} from './planner.js';

// Seed DTOs of docs/api/planner.md §4.1.
const office = (over: Partial<PlannerEventDto>): PlannerEventDto => ({
  id: 'e',
  readOnly: false,
  title: 'Dispatch standup',
  colorCodeId: 'c-meeting',
  colorCodeKey: 'meeting',
  date: '2026-09-03',
  endDate: null,
  start: '08:00',
  end: '08:30',
  timezone: 'America/Los_Angeles',
  place: null,
  notes: 'Board review: uncovered loads, HOS, delays.',
  people: ['Rosa Medina', 'Luis Ortega', 'Evan Brooks'],
  loadId: null,
  loadNumber: null,
  facility: null,
  customer: null,
  driver: null,
  truck: null,
  commodity: null,
  ...over,
});

const stop = (
  n: number,
  place: string,
  facility: string,
  customer: string,
  driver: string,
  truck: string,
  over: Partial<PlannerEventDto> = {},
): PlannerEventDto => ({
  id: `s-${n}-${place}`,
  readOnly: true,
  title: `L-${n} · ${place}`,
  colorCodeId: 'c-pickup',
  colorCodeKey: 'pickup',
  date: '2026-09-03',
  endDate: null,
  start: '10:30',
  end: '12:30',
  timezone: 'America/Los_Angeles',
  place,
  notes: `${facility} · ${customer}`,
  people: [driver],
  loadId: `load-${n}`,
  loadNumber: n,
  facility,
  customer,
  driver,
  truck,
  commodity: 'Frozen produce',
  ...over,
});

const ev1 = office({
  id: 'ev-1',
  title: 'Tobias Frey — home time',
  colorCodeId: 'c-driver',
  colorCodeKey: 'driver',
  date: '2026-09-01',
  endDate: '2026-09-06',
  start: null,
  end: null,
  notes: 'Back on duty Mon Sep 7.',
  people: ['Tobias Frey'],
});
const ev2 = office({
  id: 'ev-2',
  title: 'T-118 in shop — turbo',
  colorCodeKey: 'maintenance',
  start: null,
  end: null,
  notes: 'Sunridge shop · Modesto. Parts from Valley Diesel & Turbo.',
  people: [],
});
const ev5 = office({
  id: 'ev-5',
  title: 'FB-12 DOT annual inspection',
  colorCodeKey: 'maintenance',
  notes: 'Sunridge shop · Modesto.',
  people: ['Luis Ortega'],
});
const ev10 = office({
  id: 'ev-10',
  title: 'Safety meeting — HOS refresher',
  notes: null,
  people: ['Rosa Medina', 'Marcus Hale', 'Dara Whitfield', 'Ellis Nakamura', 'Priya Raman', 'Ana Cortez'],
});
const ev14 = office({
  id: 'ev-14',
  title: 'Marcus Hale — Clearinghouse query due',
  colorCodeKey: 'driver',
  start: null,
  end: null,
  notes: null,
  people: ['Marcus Hale'],
});
const related = office({ id: 'rel', title: 'Customer call', notes: null, people: [], loadId: 'load-40218', loadNumber: 40218 });

const l40218p = stop(40218, 'Fresno, CA', 'Northgate Cold Storage', 'Northgate Foods', 'Marcus Hale', 'T-114 / RF-88');
const l40218d = stop(40218, 'Reno, NV', 'Reno Grocers DC', 'Northgate Foods', 'Marcus Hale', 'T-114 / RF-88', { colorCodeKey: 'delivery' });
const l40212p = stop(40212, 'Los Angeles, CA', 'Bayline LA Annex', 'Bayline Distribution', 'Marcus Hale', 'T-114 / DV-88');
const l40210p = stop(40210, 'Modesto, CA', 'Sierra Ag Huller 3', 'Sierra Ag Partners', 'Tobias Frey', 'T-118 / DV-14');
const l40221p = stop(40221, 'Oakland, CA', 'Port of Oakland, Berth 22', 'Harbor Point Retail', 'Unassigned', '');
const l40221d = stop(40221, 'Portland, OR', 'Harbor Point DC', 'Harbor Point Retail', 'Unassigned', '', { colorCodeKey: 'delivery' });

const all = [ev1, ev2, ev5, ev10, ev14, related, l40218p, l40218d, l40212p, l40210p, l40221p, l40221d].map(toPlannerEventVm);
const idsMatching = (q: string) => all.filter((e) => plannerEventMatches(e, q)).map((e) => e.id);

describe('planner view-model', () => {
  it('maps the L-40218 pickup to Runtruck1’s load-stop event (planner.md §7.2)', () => {
    expect(toPlannerEventVm(l40218p)).toEqual({
      id: 's-40218-Fresno, CA',
      title: 'L-40218 · Fresno, CA',
      category: 'pickup',
      date: '2026-09-03',
      start: '10:30',
      end: '12:30',
      place: 'Fresno, CA',
      notes: 'Northgate Cold Storage · Northgate Foods',
      people: ['Marcus Hale'],
      loadId: 'L-40218',
      facility: 'Northgate Cold Storage',
      customer: 'Northgate Foods',
      driver: 'Marcus Hale',
      truck: 'T-114 / RF-88',
      commodity: 'Frozen produce',
      readOnly: true,
      colorCodeId: 'c-pickup',
      loadUuid: 'load-40218',
    });
  });

  it('maps ev-1 to Runtruck1’s office event with absent keys for nulls', () => {
    const vm = toPlannerEventVm(ev1);
    expect(vm).toEqual({
      id: 'ev-1',
      title: 'Tobias Frey — home time',
      category: 'driver',
      date: '2026-09-01',
      endDate: '2026-09-06',
      notes: 'Back on duty Mon Sep 7.',
      people: ['Tobias Frey'],
      colorCodeId: 'c-driver',
    });
    expect(Object.keys(vm)).not.toContain('start');
    expect(Object.keys(vm)).not.toContain('readOnly');
    expect(Object.keys(vm)).not.toContain('loadId');
  });

  it('keeps an empty unit label (L-40221 has no truck) and the related load number of an office event', () => {
    expect(toPlannerEventVm(l40221p).truck).toBe('');
    expect(toPlannerEventVm(related)).toMatchObject({ loadId: 'L-40218', loadUuid: 'load-40218' });
  });

  it('searches exactly Runtruck1’s planner fields (planner.md §7.4 seed checks)', () => {
    expect(plannerSearchRow(toPlannerEventVm(l40218p))).toEqual({
      title: 'L-40218 · Fresno, CA',
      place: 'Fresno, CA',
      notes: 'Northgate Cold Storage · Northgate Foods',
      people: 'Marcus Hale',
      customer: 'Northgate Foods',
      truck: 'T-114 / RF-88',
    });
    // The related-load office event is not matched by its load number.
    expect(idsMatching('l-40218')).toEqual([l40218p.id, l40218d.id]);
    expect(idsMatching('hale')).toEqual(['ev-10', 'ev-14', l40218p.id, l40218d.id, l40212p.id]);
    expect(idsMatching('modesto')).toEqual(['ev-2', 'ev-5', l40210p.id]);
    expect(idsMatching('unassigned')).toEqual([l40221p.id, l40221d.id]);
    // Commodity is never searched.
    expect(idsMatching('frozen produce')).toEqual([]);
    expect(idsMatching('   ')).toHaveLength(all.length);
  });

  it('computes Runtruck1’s stop values: "Unassigned" for empty values, JS default sort', () => {
    expect(plannerValueOf({ driver: 'Unassigned' }, 'driver')).toBe('Unassigned');
    expect(plannerValueOf({ truck: '' }, 'truck')).toBe('Unassigned');
    expect(plannerValueOf({ customer: 'Northgate Foods' }, 'customer')).toBe('Northgate Foods');
    const stops = all.filter((e) => e.readOnly);
    expect(plannerStopValues(stops, 'driver')).toEqual(['Marcus Hale', 'Tobias Frey', 'Unassigned']);
    expect(plannerStopValues(stops, 'truck')).toEqual(['T-114 / DV-88', 'T-114 / RF-88', 'T-118 / DV-14', 'Unassigned']);
    // UTF-16 order, not locale order: upper case sorts before lower case.
    expect(plannerStopValues([{ customer: 'b' }, { customer: 'B' }, { customer: 'a' }], 'customer')).toEqual(['B', 'a', 'b']);
  });

  it('picks the first unused tone for a new color code, else slate (Runtruck1 addCategory, B15)', () => {
    expect(firstUnusedPlannerTone(['amber', 'green', 'red', 'purple', 'blue', 'teal'])).toBe('pink');
    expect(firstUnusedPlannerTone([])).toBe('amber');
    expect(firstUnusedPlannerTone(PLANNER_TONES)).toBe('slate');
  });

  it('maps color codes to Runtruck1 categories and composes the dialog texts', () => {
    expect(toPlannerCategory({ id: 'c1', key: 'meeting', label: 'Meetings', tone: 'blue', locked: false, eventCount: 29 })).toEqual({
      key: 'meeting',
      label: 'Meetings',
      tone: 'blue',
      locked: false,
      id: 'c1',
      eventCount: 29,
    });
    expect(plannerDeleteCodeConfirm('Meetings', 29, 'Maintenance')).toBe('Delete “Meetings”? Its 29 events move to “Maintenance”.');
    expect(plannerDeleteCodeConfirm('Solo', 1, 'Maintenance')).toBe('Delete “Solo”? Its 1 event move to “Maintenance”.');
    expect(plannerRelatedLoadText({ loadNumber: 40218, route: 'Fresno, CA → Reno, NV' })).toBe('L-40218 · Fresno, CA → Reno, NV');
  });
});
