'use client';

import { toTruckRow, truckKpis } from '@runtruck/calculations';
import { Card, Kpis, Tag } from '@runtruck/ui';
import { useMemo } from 'react';
import { useSession } from '@/context/SessionContext';
import { useShellUi } from '@/context/ShellUiContext';
import { useTrucks } from '@/lib/api/fleet';
import { queryErrorLine } from '@/lib/api/query';
import { matchesQuery } from '@/lib/search';

// Fleet › Trucks, ported verbatim from Runtruck1 pages/app/fleet/TrucksTab.tsx
// (docs/reference/runtruck1/fleet-hr-safety.md §4). Data: GET /trucks (docs/api/fleet.md
// §5.2); KPIs from meta.summary.

export function TrucksTab() {
  const { query } = useShellUi();
  const { can } = useSession();
  const trucks = useTrucks(can('trucks.view'));

  const TRUCKS = useMemo(() => trucks.data?.data.map(toTruckRow) ?? [], [trucks.data]);
  const KPIS = truckKpis(trucks.data?.meta.summary);
  const error = trucks.data ? null : queryErrorLine(trucks.error);

  const rows = TRUCKS.filter((t) => matchesQuery(t, query));

  return (
    <>
      <Kpis items={KPIS} />

      <Card title="Power units" flush>
        <table className="ui-table">
          <thead>
            <tr>
              <th>Unit</th>
              <th>Make / year</th>
              <th>Plate</th>
              <th>Assigned to</th>
              <th className="num">Odometer</th>
              <th className="num">Next service</th>
              <th className="num">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.ref.id}>
                <td className="strong">{t.unit}</td>
                <td>{t.make}</td>
                <td className="muted">{t.plate}</td>
                <td>{t.driver}</td>
                <td className="num">{t.odo}</td>
                <td className="num">{t.service}</td>
                <td className="num">
                  <Tag label={t.status} tone={t.ref.tone} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {trucks.data && rows.length === 0 && <div className="ui-empty">Nothing matches “{query}”.</div>}
        {error && <div className="ui-empty">{error}</div>}
      </Card>
    </>
  );
}
