'use client';

import { paidInvoiceViewRow, paidKpis } from '@runtruck/calculations';
import { Card, Kpis, Tag } from '@runtruck/ui';
import { useSession } from '@/context/SessionContext';
import { useShellUi } from '@/context/ShellUiContext';
import { paidInvoicesQuery } from '@/lib/api/billing';
import { useApiQuery } from '@/lib/api/query';
import { matchesQuery } from '@/lib/search';
import { loadFailure } from './load-state';

// Runtruck1 pages/app/accounting/PaidTab.tsx, on GET /invoices?status=paid
// (docs/api/billing.md §7.5): paid invoices joined with how they were settled, most
// recently paid first. The hidden `age` and `status` fields stay searchable.
export function PaidTab() {
  const { query } = useShellUi();
  const { can } = useSession();
  const { data, error } = useApiQuery(paidInvoicesQuery, { enabled: can('billing.view') });
  const failure = loadFailure(data, error);
  const summary = data?.meta.summary;
  const rows = (data?.data ?? []).map((i) => ({ key: i.id, view: paidInvoiceViewRow(i) })).filter((i) => matchesQuery(i.view, query));

  return (
    <>
      <Kpis items={paidKpis(summary?.status === 'paid' ? summary : undefined)} />

      <Card title="Paid invoices" flush>
        <table className="ui-table">
          <thead>
            <tr>
              <th>Invoice</th><th>Customer</th><th>Load</th><th>Issued</th><th>Paid</th><th>Via</th>
              <th className="num">Amount</th><th className="num">Days to pay</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, view: i }) => (
              <tr key={key}>
                <td className="strong">{i.id}</td>
                <td>{i.customer}</td>
                <td className="muted">{i.load}</td>
                <td>{i.issued}</td>
                <td>{i.paid}</td>
                <td><Tag label={i.via} tone={i.tone} /></td>
                <td className="num">{i.amount}</td>
                <td className="num">{i.days}</td>
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
