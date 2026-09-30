'use client';

import { driverKpis, formatInt, toDriverRow, toDriverWatchlistRow } from '@runtruck/calculations';
import { Card, Kpis, Tag } from '@runtruck/ui';
import Link from 'next/link';
import { useMemo } from 'react';
import { useSession } from '@/context/SessionContext';
import { type DriverTab, useShellUi } from '@/context/ShellUiContext';
import { useComplianceReminders, useDrivers } from '@/lib/api/fleet';
import { queryErrorLine } from '@/lib/api/query';
import { matchesQuery } from '@/lib/search';

// Fleet › Drivers, ported verbatim from Runtruck1 pages/app/fleet/DriversTab.tsx
// (docs/reference/runtruck1/fleet-hr-safety.md §3). Data: GET /drivers and
// GET /compliance-reminders (docs/api/fleet.md §5.1); KPIs from meta.summary.

const TABS: DriverTab[] = ['All', 'On duty', 'Available'];

export function DriversTab() {
  const { query, driverTab, setDriverTab } = useShellUi();
  const { can } = useSession();
  const drivers = useDrivers(can('drivers.view'));
  const reminders = useComplianceReminders(can('compliance.view'));

  const DRIVERS = useMemo(() => drivers.data?.data.map(toDriverRow) ?? [], [drivers.data]);
  const WATCHLIST = useMemo(() => reminders.data?.data.map(toDriverWatchlistRow) ?? [], [reminders.data]);
  const summary = drivers.data?.meta.summary;
  const KPIS = driverKpis(summary, reminders.data?.meta.total);
  const maxMiles = summary?.maxWeekMiles ?? 0;
  const driversError = drivers.data ? null : queryErrorLine(drivers.error);
  const remindersError = reminders.data ? null : queryErrorLine(reminders.error);

  const rows = DRIVERS.filter((d) => (driverTab === 'All' || d.status === driverTab) && matchesQuery(d, query));

  const filter = (
    <div className="ui-filter">
      {TABS.map((t) => (
        <button
          key={t}
          type="button"
          className={`ui-filter-opt${driverTab === t ? ' is-active' : ''}`}
          onClick={() => {
            setDriverTab(t);
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <Kpis items={KPIS} />

      <Card title="Roster" flush action={filter}>
        <table className="ui-table">
          <thead>
            <tr>
              <th>Driver</th>
              <th>Status</th>
              <th>Unit</th>
              <th>Current load</th>
              <th className="num">Hours left</th>
              <th className="num">CDL</th>
              <th className="num">Pay YTD</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.ref.id}>
                <td className="strong">{d.name}</td>
                <td>
                  <Tag label={d.status} tone={d.ref.tone} />
                </td>
                <td>{d.unit}</td>
                <td className="muted">{d.load}</td>
                <td className="num">{d.hos}</td>
                <td className="num">{d.cdl}</td>
                <td className="num">{d.pay}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {drivers.data && rows.length === 0 && <div className="ui-empty">Nothing matches “{query}”.</div>}
        {driversError && <div className="ui-empty">{driversError}</div>}
      </Card>

      <div className="ui-grid-2">
        <Card
          title="Miles per driver, this week"
          action={summary && <span style={{ fontSize: 13, color: 'var(--ui-muted)' }}>{formatInt(summary.totalWeekMiles)} mi total</span>}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {DRIVERS.map((d) => (
              <div key={d.ref.id} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 132, flex: 'none' }}>{d.name}</div>
                <div className="ui-bar-track" style={{ flex: 1 }}>
                  <div
                    className="ui-bar-fill"
                    style={{ width: `${Math.round((d.miles / maxMiles) * 100)}%`, opacity: d.miles === maxMiles ? 1 : 0.55 }}
                  />
                </div>
                <div style={{ width: 58, flex: 'none', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {formatInt(d.miles)}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card
          title="Compliance watchlist"
          flush
          action={
            <Link className="ui-link" href="/app/safety/driver-documents" scroll={false}>
              All documents →
            </Link>
          }
        >
          <table className="ui-table">
            <thead>
              <tr>
                <th>Driver</th>
                <th>Item</th>
                <th className="num">Due</th>
              </tr>
            </thead>
            <tbody>
              {WATCHLIST.map((c) => (
                <tr key={c.ref.id}>
                  <td className="strong">{c.name}</td>
                  <td className="muted">{c.item}</td>
                  <td className="num">{c.due}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {remindersError && <div className="ui-empty">{remindersError}</div>}
        </Card>
      </div>
    </>
  );
}
