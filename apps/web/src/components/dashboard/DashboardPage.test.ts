import type { DashboardData, DashboardMeta, MeResponse } from '@runtruck/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionProvider } from '@/context/SessionContext';
import { ApiError } from '@/lib/api/client';
import { dashboardQuery } from '@/lib/api/dashboard';
import { DashboardPage } from './DashboardPage';

// The Dashboard's static markup against Runtruck1's DashboardPage.tsx (core-pages §2.1),
// for the seeded GET /dashboard response (dashboard.md §2.4–§2.5, §4) and the loading,
// refusal and error states of implementation-brief §4.

const shell = vi.hoisted(() => ({ query: '' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock('next/link', () => ({
  default: ({ href, className, children }: { href: string; className?: string; children: ReactNode }) =>
    createElement('a', { className, href }, children),
}));
vi.mock('@/context/ShellUiContext', () => ({ useShellUi: () => ({ query: shell.query }) }));

const me = (permissions: string[]): MeResponse => ({
  user: { id: 'u', fullName: 'Rosa Medina', email: 'rosa@example.test', memberNumber: '1', title: 'Dispatch' },
  organization: { id: 'o', name: 'Sunridge Freight', shortName: 'Sunridge', companyNumber: '30017', timezone: 'America/Los_Angeles' },
  permissions,
  today: '2026-09-03',
});

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const DATA: DashboardData = {
  activeLoads: [
    { id: uuid(1), loadNumber: 40218, customerName: 'Northgate Foods', route: 'Fresno, CA → Reno, NV', lineHaulCents: 245_000, status: 'in_transit' },
    { id: uuid(2), loadNumber: 40219, customerName: 'Bayline Distribution', route: 'Stockton, CA → Salt Lake City, UT', lineHaulCents: 318_000, status: 'at_pickup' },
    { id: uuid(3), loadNumber: 40220, customerName: 'Cascade Building Supply', route: 'Sacramento, CA → Boise, ID', lineHaulCents: 291_000, status: 'delayed' },
    { id: uuid(4), loadNumber: 40221, customerName: 'Harbor Point Retail', route: 'Oakland, CA → Portland, OR', lineHaulCents: 354_000, status: 'needs_driver' },
    { id: uuid(5), loadNumber: 40222, customerName: 'Cascade Building Supply', route: 'Redding, CA → Seattle, WA', lineHaulCents: 276_000, status: 'dispatched' },
  ],
  revenueLastSevenDays: [
    { date: '2026-08-27', revenueCents: 441_000 },
    { date: '2026-08-28', revenueCents: 305_000 },
    { date: '2026-08-29', revenueCents: 276_000 },
    { date: '2026-08-30', revenueCents: 774_000 },
    { date: '2026-08-31', revenueCents: 486_000 },
    { date: '2026-09-01', revenueCents: 930_000 },
    { date: '2026-09-02', revenueCents: 1_052_000 },
  ],
  drivers: [
    { id: uuid(11), name: 'Marcus Hale', dutyStatus: 'on_duty', hosRemainingMinutes: 380 },
    { id: uuid(12), name: 'Dara Whitfield', dutyStatus: 'on_duty', hosRemainingMinutes: 545 },
    { id: uuid(13), name: 'Ellis Nakamura', dutyStatus: 'on_duty', hosRemainingMinutes: 105 },
    { id: uuid(14), name: 'Priya Raman', dutyStatus: 'available', hosRemainingMinutes: 660 },
    { id: uuid(15), name: 'Ana Cortez', dutyStatus: 'available', hosRemainingMinutes: 660 },
    { id: uuid(16), name: 'Tobias Frey', dutyStatus: 'home_time', hosRemainingMinutes: null },
  ],
};

const META: DashboardMeta = {
  today: '2026-09-03',
  weekStart: '2026-08-31',
  weekEnd: '2026-09-06',
  summary: {
    activeLoads: { count: 5, lastWeekCount: 3, deltaVsLastWeek: 2 },
    revenueThisWeek: { thisWeekCents: 2_468_000, previousWeekCents: 1_796_000, changeTenthsOfPercent: 374 },
    deadheadMiles: { percentTenths: 78, previousWeekPercentTenths: 92, pointsBetterTenths: 14 },
    unbilledLoads: { count: 11, amountCents: 3_490_000 },
  },
};

// Runtruck1's markup (pages/app/DashboardPage.tsx with components/Kpis, Card, Tag), written
// out from its JSX with the values the seed must render.
interface R1Row {
  id: string;
  customer: string;
  route: string;
  rate: string;
  status: string;
  chip: string;
}
interface R1 {
  kpis: { label: string; value: string; note?: string }[];
  rows: R1Row[];
  tail: string;
  chart: { day: string; h: string; fill: string }[];
  drivers: { name: string; note: string; dot: string }[];
}

function runtruck1(v: R1): string {
  const kpis = v.kpis
    .map(
      (k) =>
        `<div class="ui-kpi is-clickable"><div><div class="ui-kpi-label">${k.label}</div>${k.note ? `<div class="ui-kpi-note">${k.note}</div>` : ''}</div><div class="ui-kpi-value">${k.value}</div></div>`,
    )
    .join('');
  const card = (title: string, flush: boolean, action: string, body: string) =>
    `<section class="ui-card "><div class="ui-card-head"><div class="ui-card-title">${title}</div><div style="flex:1"></div>${action}</div><div class="${flush ? 'ui-card-flush' : 'ui-card-body'}">${body}</div></section>`;
  const rows = v.rows
    .map(
      (l) =>
        `<tr class="is-clickable"><td class="strong">${l.id}</td><td>${l.customer}</td><td class="muted">${l.route}</td><td class="num">${l.rate}</td><td class="num"><span class="ui-chip ${l.chip}">${l.status}</span></td></tr>`,
    )
    .join('');
  const table = `<table class="ui-table"><thead><tr><th>Load</th><th>Customer</th><th>Route</th><th class="num">Rate</th><th class="num">Status</th></tr></thead><tbody>${rows}</tbody></table>${v.tail}`;
  const chart = `<div style="display:grid;grid-template-columns:repeat(${v.chart.length}, minmax(0, 1fr));gap:10px">${v.chart
    .map(
      (c) =>
        `<div style="display:flex;flex-direction:column;align-items:center;gap:8px"><div style="display:flex;align-items:flex-end;width:100%;height:120px"><div style="width:100%;height:${c.h};background:${c.fill};border-radius:6px"></div></div><div style="font-size:11px;font-weight:600;color:var(--ui-muted)">${c.day}</div></div>`,
    )
    .join('')}</div>`;
  const drivers = v.drivers
    .map(
      (d, i) =>
        `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-top:${i ? '1px solid var(--ui-border)' : '0'};cursor:pointer"><div style="width:8px;height:8px;border-radius:999px;background:${d.dot};flex:none"></div><div style="flex:1;font-weight:600">${d.name}</div><div style="font-size:12px;color:var(--ui-muted)">${d.note}</div></div>`,
    )
    .join('');
  return (
    `<div class="ui-kpis">${kpis}</div>` +
    `<div class="ui-grid-2">${card('Active loads', true, '<a class="ui-link" href="/app/loads">View all</a>', table)}` +
    `<div style="display:flex;flex-direction:column;gap:20px;min-width:0">${card('Revenue, last 7 days', false, '', chart)}${card('Drivers', false, '', drivers)}</div></div>`
  );
}

const SEED_KPIS = [
  { label: 'Active loads', value: '5', note: '+2 vs. last week' },
  { label: 'Revenue this week', value: '$25K', note: '+37.4%' },
  { label: 'Deadhead miles', value: '7.8%', note: '1.4 pts better' },
  { label: 'Unbilled loads', value: '11', note: '$34,900 waiting' },
];
const PENDING_KPIS = SEED_KPIS.map(({ label }) => ({ label, value: '—' }));

const SEED_ROWS: R1Row[] = [
  { id: 'L-40218', customer: 'Northgate Foods', route: 'Fresno, CA → Reno, NV', rate: '$2,450', status: 'In transit', chip: 'ui-chip-blue' },
  { id: 'L-40219', customer: 'Bayline Distribution', route: 'Stockton, CA → Salt Lake City, UT', rate: '$3,180', status: 'At pickup', chip: 'ui-chip-gray' },
  { id: 'L-40220', customer: 'Cascade Building Supply', route: 'Sacramento, CA → Boise, ID', rate: '$2,910', status: 'Delayed', chip: 'ui-chip-amber' },
  { id: 'L-40221', customer: 'Harbor Point Retail', route: 'Oakland, CA → Portland, OR', rate: '$3,540', status: 'Needs driver', chip: 'ui-chip-amber' },
  { id: 'L-40222', customer: 'Cascade Building Supply', route: 'Redding, CA → Seattle, WA', rate: '$2,760', status: 'Dispatched', chip: 'ui-chip-gray' },
];

const soft = 'var(--ui-primary-soft)';
const SEED_CHART = [
  { day: 'Thu', h: '42%', fill: soft },
  { day: 'Fri', h: '29%', fill: soft },
  { day: 'Sat', h: '26%', fill: soft },
  { day: 'Sun', h: '74%', fill: soft },
  { day: 'Mon', h: '46%', fill: soft },
  { day: 'Tue', h: '88%', fill: soft },
  { day: 'Wed', h: '100%', fill: 'var(--ui-primary)' },
];

const SEED_DRIVERS = [
  { name: 'Marcus Hale', note: 'On duty · 6h 20m left', dot: 'var(--ui-primary)' },
  { name: 'Dara Whitfield', note: 'On duty · 9h 05m left', dot: 'var(--ui-primary)' },
  { name: 'Ellis Nakamura', note: 'On duty · 1h 45m left', dot: 'var(--ui-primary)' },
  { name: 'Priya Raman', note: 'Available', dot: 'var(--ui-green)' },
  { name: 'Ana Cortez', note: 'Available', dot: 'var(--ui-green)' },
  { name: 'Tobias Frey', note: 'Home time', dot: 'var(--ui-muted)' },
];

const SEEDED: R1 = { kpis: SEED_KPIS, rows: SEED_ROWS, tail: '', chart: SEED_CHART, drivers: SEED_DRIVERS };
// Pending or refused: the structure, KPI "—" without notes, no rows, bars, drivers or empty line.
const PENDING: R1 = { kpis: PENDING_KPIS, rows: [], tail: '', chart: [], drivers: [] };

function render(client: QueryClient, permissions = ['dashboard.view']): string {
  // SessionProvider types `children` as a required prop; it is passed as createElement's child.
  const session = createElement(SessionProvider, { me: me(permissions) } as { me: MeResponse; children: ReactNode }, createElement(DashboardPage));
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, session));
}

function seeded(): QueryClient {
  const client = new QueryClient();
  client.setQueryData(dashboardQuery.queryKey, { data: DATA, meta: META });
  return client;
}

// A cache holding `error` for the dashboard key, as after a failed fetch (retryOnMount off,
// so the static render keeps the error state).
function failed(error: Error): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retryOnMount: false } } });
  client.getQueryCache().build(client, { queryKey: dashboardQuery.queryKey }).setState({ status: 'error', error, fetchStatus: 'idle' });
  return client;
}

beforeEach(() => {
  shell.query = '';
});

describe('DashboardPage markup (Runtruck1 parity)', () => {
  it('renders the seeded response exactly as Runtruck1 lays it out (§4)', () => {
    expect(render(seeded())).toBe(runtruck1(SEEDED));
  });

  it('filters the table while searching, with the raw query in the empty line (B2, B9)', () => {
    // Without loads.view the search runs over the active rows (dashboard.md §5.3).
    shell.query = 'cascade';
    expect(render(seeded())).toBe(runtruck1({ ...SEEDED, rows: [SEED_ROWS[2]!, SEED_ROWS[4]!] }));
    shell.query = ' zzz ';
    expect(render(seeded())).toBe(runtruck1({ ...SEEDED, rows: [], tail: '<div class="ui-empty">Nothing matches “ zzz ”.</div>' }));
  });

  it('renders the structure only while pending or refused (implementation-brief §4 rules 2–3)', () => {
    expect(render(new QueryClient())).toBe(runtruck1(PENDING));
    shell.query = 'cascade';
    expect(render(new QueryClient())).toBe(runtruck1(PENDING));
    expect(render(new QueryClient(), [])).toBe(runtruck1(PENDING));
    expect(render(failed(new ApiError(403, 'FORBIDDEN', 'You do not have permission.', 'r1')))).toBe(runtruck1(PENDING));
  });

  it('adds one ui-empty line with the API message on any other error (rule 4)', () => {
    const html = render(failed(new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong.', 'r1')));
    expect(html).toBe(runtruck1({ ...PENDING, tail: '<div class="ui-empty">Something went wrong.</div>' }));
  });
});
