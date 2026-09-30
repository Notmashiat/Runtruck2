import type { DashboardLoadRowVm } from '@runtruck/calculations';
import { describe, expect, it } from 'vitest';
import { dashboardTable } from './dashboardTable';

// docs/api/dashboard.md §5.3: the card's rows while idle, searching, pending and empty.

const row = (id: string, status: string, extra: Record<string, string> = {}): DashboardLoadRowVm & Record<string, string> => ({
  id,
  customer: 'Cascade Building Supply',
  route: 'Redding, CA → Seattle, WA',
  rate: '$2,760',
  status,
  tone: 'gray',
  ...extra,
});

const active = ['L-40218', 'L-40219', 'L-40220', 'L-40221', 'L-40222'].map((id) => row(id, 'In transit'));
const board = [
  row('L-40218', 'In transit', { carrierMc: 'MC 812044' }),
  row('L-40212', 'Delivered', { carrierMc: 'MC 812044' }),
  row('L-40210', 'Delivered', { carrierMc: 'MC 812044' }),
  row('L-40221', 'Needs driver', { carrierMc: '—' }),
];

describe('dashboardTable', () => {
  it('shows the active rows without a search (whitespace is no search)', () => {
    expect(dashboardTable('', active, board)).toEqual({ rows: active, loaded: true });
    expect(dashboardTable('   ', active, board).rows.map((r) => r.id)).toEqual(active.map((r) => r.id));
  });

  it('searches every board load, non-active ones and hidden fields included (B3)', () => {
    expect(dashboardTable('delivered', active, board).rows.map((r) => r.id)).toEqual(['L-40212', 'L-40210']);
    expect(dashboardTable(' 812044 ', active, board).rows.map((r) => r.id)).toEqual(['L-40218', 'L-40212', 'L-40210']);
  });

  it('never matches the tone', () => {
    expect(dashboardTable('gray', active, board)).toEqual({ rows: [], loaded: true });
  });

  it('keeps at most 6 rows', () => {
    const many = Array.from({ length: 9 }, (_, i) => row(`L-${50000 + i}`, 'Dispatched'));
    expect(dashboardTable('', many, many).rows).toHaveLength(6);
    expect(dashboardTable('dispatched', many, many).rows.map((r) => r.id)).toEqual(many.slice(0, 6).map((r) => r.id));
  });

  it('reports an empty but loaded result, so the card prints "Nothing matches"', () => {
    expect(dashboardTable('zzz', active, board)).toEqual({ rows: [], loaded: true });
    expect(dashboardTable('', [], board)).toEqual({ rows: [], loaded: true });
  });

  it('shows nothing, not even the empty line, while the source is pending', () => {
    expect(dashboardTable('', undefined, board)).toEqual({ rows: [], loaded: false });
    expect(dashboardTable('delivered', active, undefined)).toEqual({ rows: [], loaded: false });
  });

  it('shows no search rows while GET /dashboard is pending or refused (dashboard.md §5.1)', () => {
    expect(dashboardTable('delivered', undefined, board)).toEqual({ rows: [], loaded: false });
    expect(dashboardTable('zzz', undefined, board)).toEqual({ rows: [], loaded: false });
  });
});
