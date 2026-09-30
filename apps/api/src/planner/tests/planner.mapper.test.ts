import { plannerEventCreateSchema } from '@runtruck/validation';
import { describe, expect, it } from 'vitest';
import {
  changedEventFields,
  concatPage,
  eventColumns,
  fallbackColorCode,
  hhmm,
  likeContains,
  mergeEventPatch,
  nextPosition,
  officeEventDto,
  pickFields,
  stopEventDto,
  storedEventFields,
  type StoredEventRow,
} from '../planner.mapper.js';
import { colorCodeDeletedAudit, eventCreatedEvent, eventUpdatedAudit, resetAudit, resetEvent } from '../planner.events.js';

const ev1Row: StoredEventRow = {
  id: 'e1',
  title: 'Tobias Frey — home time',
  colorCodeId: '11111111-1111-4111-8111-111111111111',
  startDate: '2026-09-01',
  endDate: '2026-09-06',
  startTime: null,
  endTime: null,
  place: null,
  notes: 'Back on duty Mon Sep 7.',
  people: ['Tobias Frey'],
  loadId: null,
};

const standupRow: StoredEventRow = {
  ...ev1Row,
  title: 'Dispatch standup',
  startDate: '2026-09-03',
  endDate: null,
  startTime: '08:00:00',
  endTime: '08:30:00',
};

describe('planner mapper', () => {
  it('sends HH:MM times (docs/api/planner.md §2.1)', () => {
    expect(hhmm('08:30:00')).toBe('08:30');
    expect(hhmm(null)).toBeNull();
  });

  it('builds the ev-1 office DTO of §4.1', () => {
    const dto = officeEventDto({ ...ev1Row, colorCodeKey: 'driver', loadNumber: null }, 'America/Los_Angeles');
    expect(dto).toEqual({
      id: 'e1',
      readOnly: false,
      title: 'Tobias Frey — home time',
      colorCodeId: ev1Row.colorCodeId,
      colorCodeKey: 'driver',
      date: '2026-09-01',
      endDate: '2026-09-06',
      start: null,
      end: null,
      timezone: 'America/Los_Angeles',
      place: null,
      notes: 'Back on duty Mon Sep 7.',
      people: ['Tobias Frey'],
      loadId: null,
      loadNumber: null,
      facility: null,
      customer: null,
      driver: null,
      truck: null,
      commodity: null,
    });
  });

  it('builds the L-40218 pickup DTO of §4.1 with people = [driver label]', () => {
    const dto = stopEventDto({
      id: 's1',
      loadId: 'l1',
      loadNumber: 40218,
      colorCodeId: 'c-pickup',
      colorCodeKey: 'pickup',
      date: '2026-09-03',
      start: '10:30:00',
      end: '12:30:00',
      timezone: 'America/Los_Angeles',
      title: 'L-40218 · Fresno, CA',
      place: 'Fresno, CA',
      notes: 'Northgate Cold Storage · Northgate Foods',
      facility: 'Northgate Cold Storage',
      customer: 'Northgate Foods',
      driver: 'Marcus Hale',
      truck: 'T-114 / RF-88',
      commodity: 'Frozen produce',
    });
    expect(dto).toMatchObject({
      readOnly: true,
      start: '10:30',
      end: '12:30',
      endDate: null,
      people: ['Marcus Hale'],
      loadNumber: 40218,
      truck: 'T-114 / RF-88',
    });
  });

  it('merges a PATCH over the stored event and re-validates the result (§3.3)', () => {
    const before = storedEventFields(standupRow);
    expect(before).toMatchObject({ date: '2026-09-03', start: '08:00', end: '08:30', endDate: null });

    // Timed → all-day: both times cleared.
    const allDay = plannerEventCreateSchema.parse(mergeEventPatch(before, { start: null, end: null }));
    expect(allDay).toMatchObject({ start: null, end: null, endDate: null });
    expect(changedEventFields(before, allDay)).toEqual(['start', 'end']);

    // An end date on a timed event is refused on the merged row.
    const bad = plannerEventCreateSchema.safeParse(mergeEventPatch(before, { endDate: '2026-09-05' }));
    expect(bad.success).toBe(false);
    expect(bad.error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([
      ['endDate', 'Only all-day events can span several days.'],
    ]);

    // An end date equal to the start date is dropped (Runtruck1 save).
    const same = plannerEventCreateSchema.parse(mergeEventPatch(storedEventFields(ev1Row), { endDate: '2026-09-01' }));
    expect(same.endDate).toBeNull();
  });

  it('treats an identical save as a no-op and compares people element-wise', () => {
    const before = storedEventFields(ev1Row);
    const again = plannerEventCreateSchema.parse(
      mergeEventPatch(before, { title: '  Tobias Frey — home time ', people: [' Tobias Frey'] }),
    );
    expect(changedEventFields(before, again)).toEqual([]);
    const more = plannerEventCreateSchema.parse(mergeEventPatch(before, { people: ['Tobias Frey', 'Rosa Medina'] }));
    expect(changedEventFields(before, more)).toEqual(['people']);
    expect(pickFields(more, ['people'])).toEqual({ people: ['Tobias Frey', 'Rosa Medina'] });
  });

  it('maps event fields to planner_events columns', () => {
    expect(eventColumns(storedEventFields(standupRow))).toMatchObject({
      startDate: '2026-09-03',
      startTime: '08:00',
      endTime: '08:30',
      endDate: null,
    });
  });

  it('escapes LIKE wildcards so q is a literal substring (§2.6)', () => {
    expect(likeContains('hale')).toBe('%hale%');
    expect(likeContains('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });

  it('pages the concatenated list, office events first (§3.1)', () => {
    expect(concatPage(['o1', 'o2'], ['s1', 's2', 's3'], 0, 3)).toEqual(['o1', 'o2', 's1']);
    expect(concatPage(['o1', 'o2'], ['s1', 's2', 's3'], 3, 3)).toEqual(['s2', 's3']);
  });

  it('positions a new code after the others and picks the delete fallback in list order (§3.6, §3.8)', () => {
    expect(nextPosition([1, 2, 3, 4, 5, 6])).toBe(7);
    expect(nextPosition([])).toBe(1);
    const ordered = [
      { id: 'pickup', isLocked: true },
      { id: 'delivery', isLocked: true },
      { id: 'maintenance', isLocked: false },
      { id: 'driver', isLocked: false },
    ];
    expect(fallbackColorCode(ordered, 'maintenance')?.id).toBe('driver');
    expect(fallbackColorCode(ordered, 'driver')?.id).toBe('maintenance');
    expect(fallbackColorCode(ordered.slice(0, 3), 'maintenance')).toBeUndefined();
  });
});

describe('planner audit and events (§5)', () => {
  it('records ids-only payloads and field-level audit rows', () => {
    const fields = storedEventFields(standupRow);
    expect(eventCreatedEvent('e9', fields)).toEqual({
      type: 'PlannerEventCreated',
      aggregateType: 'planner_event',
      aggregateId: 'e9',
      payload: { plannerEventId: 'e9', colorCodeId: fields.colorCodeId, startsOn: '2026-09-03' },
    });
    expect(eventUpdatedAudit('e9', 'Dispatch standup', { title: 'A' }, { title: 'B' })).toMatchObject({
      action: 'PLANNER_EVENT_UPDATED',
      entityType: 'planner_event',
      entityLabel: 'Dispatch standup',
      previous: { title: 'A' },
      next: { title: 'B' },
    });
    expect(colorCodeDeletedAudit('c1', { key: 'meeting', label: 'Meetings', tone: 'blue' }, 'c2', 29)).toMatchObject({
      previous: { key: 'meeting', label: 'Meetings', tone: 'blue' },
      next: { reassignedToColorCodeId: 'c2', reassignedEventCount: 29 },
    });
    expect(
      resetAudit('org', 'Sunridge Freight', { eventCount: 43, colorCodeCount: 7 }, { eventCount: 42, colorCodeCount: 6 }),
    ).toMatchObject({
      action: 'PLANNER_RESET',
      entityType: 'organization',
      entityId: 'org',
      entityLabel: 'Sunridge Freight',
    });
    expect(resetEvent('org', { eventCount: 42, colorCodeCount: 6 })).toEqual({
      type: 'PlannerReset',
      aggregateType: 'organization',
      aggregateId: 'org',
      payload: { eventCount: 42, colorCodeCount: 6 },
    });
  });
});
