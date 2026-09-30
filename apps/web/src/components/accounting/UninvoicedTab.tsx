'use client';

import { uninvoicedKpis, uninvoicedViewRow } from '@runtruck/calculations';
import { Card, Kpis, Tag } from '@runtruck/ui';
import { useSession } from '@/context/SessionContext';
import { useShellUi } from '@/context/ShellUiContext';
import { uninvoicedLoadsQuery } from '@/lib/api/billing';
import { useApiQuery } from '@/lib/api/query';
import { matchesQuery } from '@/lib/search';
import { loadFailure } from './load-state';

// Runtruck1 pages/app/accounting/UninvoicedTab.tsx, on GET /billing/uninvoiced-loads
// (docs/api/billing.md §7.1). KPIs come from meta.summary; search never changes them.
export function UninvoicedTab() {
  const { query } = useShellUi();
  const { can } = useSession();
  const { data, error } = useApiQuery(uninvoicedLoadsQuery, { enabled: can('billing.view') });
  const failure = loadFailure(data, error);
  const rows = (data?.data ?? []).map((l) => ({ key: l.loadId, view: uninvoicedViewRow(l) })).filter((l) => matchesQuery(l.view, query));

  return (
    <>
      <Kpis items={uninvoicedKpis(data?.meta.summary)} />

      <Card title="Delivered, not yet invoiced" flush>
        <table className="ui-table">
          <thead>
            <tr>
              <th>Load</th><th>Customer</th><th>Route</th><th>Delivered</th><th>POD</th><th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, view: l }) => (
              <tr key={key}>
                <td className="strong">{l.id}</td>
                <td>{l.customer}</td>
                <td className="muted">{l.route}</td>
                <td>{l.delivered}</td>
                <td><Tag label={l.pod} tone={l.tone} /></td>
                <td className="num">{l.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {failure !== undefined && <div className="ui-empty">{failure}</div>}
        {data && rows.length === 0 && <div className="ui-empty">Nothing matches “{query}”.</div>}
      </Card>
    </>
  );
}
