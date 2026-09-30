'use client';

import {
  dashboardKpis,
  type DashboardKpiLabel,
  type DashboardLoadRowVm,
  dashboardRevenueChart,
  toDashboardDriverRow,
  toDashboardRow,
  toLoadSearchRow,
} from '@runtruck/calculations';
import { Card, Kpis, Tag } from '@runtruck/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { useSession } from '@/context/SessionContext';
import { useShellUi } from '@/context/ShellUiContext';
import { useDashboard } from '@/lib/api/dashboard';
import { queryErrorLine } from '@/lib/api/query';
import { useLoadsBoard } from '@/lib/api/loads';
import { dashboardTable } from './dashboardTable';

// The Dashboard, ported verbatim from Runtruck1 pages/app/DashboardPage.tsx
// (docs/reference/runtruck1/core-pages.md §2). Data: GET /dashboard (KPIs from
// meta.summary, table, chart and drivers computed from records, D5) and, for the table's
// search, the Loads board rows of GET /loads (docs/api/dashboard.md §5).

// KPI targets (the query is not cleared, Runtruck1 B9).
const KPI_HREF: Record<DashboardKpiLabel, string> = {
  'Active loads': '/app/loads',
  'Revenue this week': '/app/accounting/invoiced',
  'Deadhead miles': '/app/fleet/trucks',
  'Unbilled loads': '/app/accounting/uninvoiced',
};

export function DashboardPage() {
  const router = useRouter();
  const navigate = (href: string) => {
    router.push(href, { scroll: false });
  };
  const { query } = useShellUi();
  const { me, can } = useSession();
  const canViewLoads = can('loads.view');
  const dashboard = useDashboard(can('dashboard.view'));
  const board = useLoadsBoard(canViewLoads);
  const timeZone = me.organization.timezone;
  const today = me.today;

  const data = dashboard.data?.data;
  const active = useMemo<DashboardLoadRowVm[] | undefined>(() => data?.activeLoads.map(toDashboardRow), [data]);
  const loads = useMemo<DashboardLoadRowVm[] | undefined>(
    () => (canViewLoads ? board.data?.data.map((l) => toLoadSearchRow(l, { timeZone, today })) : active),
    [canViewLoads, board.data, active, timeZone, today],
  );
  const CHART = useMemo(() => (data ? dashboardRevenueChart(data.revenueLastSevenDays) : []), [data]);
  const DRIVER_ROWS = useMemo(() => data?.drivers.map(toDashboardDriverRow) ?? [], [data]);

  const searching = query.trim().length > 0;
  const { rows, loaded } = dashboardTable(query, active, loads);
  const errorLine =
    (dashboard.data ? null : queryErrorLine(dashboard.error)) ??
    (searching && canViewLoads && !board.data ? queryErrorLine(board.error) : null);

  const kpis = dashboardKpis(dashboard.data?.meta.summary).map((k) => ({
    ...k,
    onClick: () => {
      navigate(KPI_HREF[k.label]);
    },
  }));

  return (
    <>
      <Kpis items={kpis} />

      <div className="ui-grid-2">
        <Card
          title="Active loads"
          flush
          action={
            <Link className="ui-link" href="/app/loads" scroll={false}>
              View all
            </Link>
          }
        >
          <table className="ui-table">
            <thead>
              <tr>
                <th>Load</th>
                <th>Customer</th>
                <th>Route</th>
                <th className="num">Rate</th>
                <th className="num">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr
                  key={l.id}
                  className="is-clickable"
                  onClick={() => {
                    navigate(`/app/loads/${l.id}`);
                  }}
                >
                  <td className="strong">{l.id}</td>
                  <td>{l.customer}</td>
                  <td className="muted">{l.route}</td>
                  <td className="num">{l.rate}</td>
                  <td className="num">
                    <Tag label={l.status} tone={l.tone} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loaded && rows.length === 0 && !errorLine && <div className="ui-empty">Nothing matches “{query}”.</div>}
          {errorLine && <div className="ui-empty">{errorLine}</div>}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <Card title="Revenue, last 7 days">
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${CHART.length}, minmax(0, 1fr))`, gap: 10 }}>
              {CHART.map((c) => (
                <div key={c.day} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', width: '100%', height: 120 }}>
                    <div style={{ width: '100%', height: c.h, background: c.fill, borderRadius: 6 }} />
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ui-muted)' }}>{c.day}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Drivers">
            {DRIVER_ROWS.map((d, i) => (
              <div
                key={d.id}
                onClick={() => {
                  navigate('/app/fleet/drivers');
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 0',
                  borderTop: i ? '1px solid var(--ui-border)' : 0,
                  cursor: 'pointer',
                }}
              >
                <div style={{ width: 8, height: 8, borderRadius: 999, background: d.dot, flex: 'none' }} />
                <div style={{ flex: 1, fontWeight: 600 }}>{d.name}</div>
                <div style={{ fontSize: 12, color: 'var(--ui-muted)' }}>{d.note}</div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </>
  );
}
