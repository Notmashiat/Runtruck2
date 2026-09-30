'use client';

import { formatMoney, toWorkOrderRow, workOrderKpis } from '@runtruck/calculations';
import { Card, Kpis, Tag } from '@runtruck/ui';
import { useMemo } from 'react';
import { useSession } from '@/context/SessionContext';
import { useShellUi } from '@/context/ShellUiContext';
import { useWorkOrders } from '@/lib/api/safety';
import { queryErrorLine } from '@/lib/api/query';
import { matchesQuery } from '@/lib/search';

// Safety › Maintenance, ported verbatim from Runtruck1 pages/app/safety/MaintenanceTab.tsx
// (docs/reference/runtruck1/fleet-hr-safety.md §8). Data: GET /work-orders (docs/api/safety.md
// §7.1); KPIs from meta.summary. The estimate cell formats the row's cents.

export function MaintenanceTab() {
  const { query } = useShellUi();
  const { can } = useSession();
  const workOrders = useWorkOrders(can('maintenance.view'));

  const MAINTENANCE = useMemo(() => workOrders.data?.data.map(toWorkOrderRow) ?? [], [workOrders.data]);
  const KPIS = workOrderKpis(workOrders.data?.meta.summary);
  const error = workOrders.data ? null : queryErrorLine(workOrders.error);

  const rows = MAINTENANCE.filter((w) => matchesQuery(w, query));

  return (
    <>
      <Kpis items={KPIS} />

      <Card title="Work orders" flush>
        <table className="ui-table">
          <thead>
            <tr>
              <th>Unit</th><th>Item</th><th>Due</th><th>Shop</th><th className="num">Estimate</th><th className="num">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.ref.id}>
                <td className="strong">{w.unit}</td>
                <td>{w.item}</td>
                <td>{w.due}</td>
                <td className="muted">{w.shop}</td>
                <td className="num">{formatMoney(w.ref.estimateCents)}</td>
                <td className="num"><Tag label={w.status} tone={w.ref.tone} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {workOrders.data && rows.length === 0 && <div className="ui-empty">Nothing matches “{query}”.</div>}
        {error && <div className="ui-empty">{error}</div>}
      </Card>
    </>
  );
}
