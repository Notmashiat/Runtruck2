import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/client';
import { plannerRange, plannerWriteError, toPlannerEventBody } from '@/lib/api/planner';
import { queryErrorLine } from '@/lib/api/query';
import { addMonths, formatTime, fromIso, iso, shortLabel, startOfWeek, toHhmm, toMinutes } from '@/lib/dates';
import { DEFAULT_PREFS, revivePrefs } from './planner-data';

// Pure planner helpers of the web (docs/api/planner.md §7.1, §7.5; port spec §4).

const today = fromIso('2026-09-03');

describe('planner date helpers (Runtruck1 lib/dates.ts)', () => {
  it('formats times and labels like Runtruck1', () => {
    expect([480, 510, 720, 0].map((m) => formatTime(m, false))).toEqual(['8 AM', '8:30 AM', '12 PM', '12 AM']);
    expect(formatTime(1050, true)).toBe('17:30');
    expect(shortLabel(today)).toBe('Thu, Sep 3');
    expect(toMinutes('10:30')).toBe(630);
    expect(toMinutes('')).toBe(0);
    expect(toHhmm(1425)).toBe('23:45');
    expect(iso(startOfWeek(today, 1))).toBe('2026-08-31');
    expect(iso(addMonths(today, 1))).toBe('2026-10-01');
  });
});

describe('plannerRange (§7.1)', () => {
  it('covers the visible days of each view', () => {
    expect(plannerRange('Day', today, 1)).toEqual({ from: '2026-09-03', to: '2026-09-03' });
    expect(plannerRange('Week', today, 1)).toEqual({ from: '2026-08-31', to: '2026-09-06' });
    expect(plannerRange('Week', today, 0)).toEqual({ from: '2026-08-30', to: '2026-09-05' });
    expect(plannerRange('Month', today, 1)).toEqual({ from: '2026-08-31', to: '2026-10-04' });
    expect(plannerRange('Month', fromIso('2026-08-01'), 1)).toEqual({ from: '2026-07-27', to: '2026-09-06' });
  });
});

describe('toPlannerEventBody (§7.5)', () => {
  const codes = [
    { key: 'meeting', id: 'c-meeting' },
    { key: 'admin', id: 'c-admin' },
  ];
  const loads = [{ id: 'load-40218', loadNumber: 40218 }];

  it('sends every field of a saved timed event', () => {
    expect(
      toPlannerEventBody(
        {
          id: 'ev-1',
          title: 'Yard walk',
          category: 'meeting',
          date: '2026-09-03',
          start: '15:00',
          end: '16:00',
          place: 'Modesto, CA',
          notes: ' x ',
          people: ['Rosa Medina'],
          loadId: 'L-40218',
        },
        codes,
        loads,
      ),
    ).toEqual({
      title: 'Yard walk',
      colorCodeId: 'c-meeting',
      date: '2026-09-03',
      endDate: null,
      start: '15:00',
      end: '16:00',
      place: 'Modesto, CA',
      notes: ' x ',
      people: ['Rosa Medina'],
      loadId: 'load-40218',
    });
  });

  it('saves a cleared "Starts" as an all-day event (quirk B5)', () => {
    const body = toPlannerEventBody({ id: 'e', title: 'X', category: 'admin', date: '2026-09-03', start: '', end: '10:00' }, codes, loads);
    expect(body).toMatchObject({
      start: null,
      end: null,
      endDate: null,
      colorCodeId: 'c-admin',
      people: [],
      place: null,
      notes: null,
      loadId: null,
    });
  });

  it('keeps an unchanged link to a load that is not in the list (archived, or no loads.view)', () => {
    const body = toPlannerEventBody(
      { id: 'e', title: 'X', category: 'admin', date: '2026-09-03', endDate: '2026-09-05', loadId: 'L-40001', loadUuid: 'old-load' },
      codes,
      [],
    );
    expect(body).toMatchObject({ loadId: 'old-load', endDate: '2026-09-05', start: null });
  });
});

describe('read and write failures (implementation-brief §4, P7)', () => {
  it('adds no line for a refusal, the API message for any other error', () => {
    expect(queryErrorLine(null)).toBeNull();
    expect(queryErrorLine(new ApiError(403, 'FORBIDDEN', 'You do not have permission to do that.', 'r1'))).toBeNull();
    expect(queryErrorLine(new ApiError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', 'r2'))).toBe('Some fields are invalid.');
    expect(queryErrorLine(new TypeError('fetch failed'))).toBe('Something went wrong.');
    expect(plannerWriteError(new ApiError(404, 'PLANNER_EVENT_NOT_FOUND', 'Event was not found.', 'r3'))).toBe('Event was not found.');
    expect(plannerWriteError(new Error('boom'))).toBe('Something went wrong.');
  });
});

describe('view preferences', () => {
  it('merge any stored object over the defaults, as Runtruck1 revivePrefs', () => {
    expect(revivePrefs({ view: 'Month' })).toEqual({ ...DEFAULT_PREFS, view: 'Month' });
    expect(revivePrefs(null)).toBeNull();
    expect(revivePrefs('x')).toBeNull();
  });
});
