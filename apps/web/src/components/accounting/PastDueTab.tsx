'use client';

import { invoiceViewRow, pastDueKpis } from '@runtruck/calculations';
import { Card, Kpis, Tag } from '@runtruck/ui';
import { useSession } from '@/context/SessionContext';
import { useShellUi } from '@/context/ShellUiContext';
import { overdueInvoicesQuery } from '@/lib/api/billing';
import { useApiQuery } from '@/lib/api/query';
import { matchesQuery } from '@/lib/search';
import { loadFailure } from './load-state';

// Runtruck1 pages/app/accounting/PastDueTab.tsx, on GET /invoices?status=overdue
// (docs/api/billing.md §7.4). Oldest first: the order collections works them in.
export function PastDueTab() {
  const { query } = useShellUi();
  const { can } = useSession();
  const { data, error } = useApiQuery(overdueInvoicesQuery, { enabled: can('billing.view') });
  const failure = loadFailure(data, error);
  const summary = data?.meta.summary;
  const rows = (data?.data ?? []).map((i) => ({ key: i.id, view: invoiceViewRow(i) })).filter((i) => matchesQuery(i.view, query));

  return (
    <>
      <Kpis items={pastDueKpis(summary?.status === 'overdue' ? summary : undefined)} />

      <Card title="Past due" flush>
        <table className="ui-table">
          <thead>
            <tr>
              <th>Invoice</th><th>Customer</th><th>Load</th><th>Issued</th>
              <th className="num">Amount</th><th className="num">Age</th><th className="num">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, view: i }) => (
              <tr key={key}>
                <td className="strong">{i.id}</td>
                <td>{i.customer}</td>
                <td className="muted">{i.load}</td>
                <td>{i.issued}</td>
                <td className="num">{i.amount}</td>
                <td className="num">{i.age}</td>
                <td className="num"><Tag label={i.status} tone={i.tone} /></td>
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
