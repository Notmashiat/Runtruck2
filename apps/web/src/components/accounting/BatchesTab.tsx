'use client';

import { invoiceBatchesKpis, invoiceBatchViewRow } from '@runtruck/calculations';
import { Card, Kpis, Tag } from '@runtruck/ui';
import { useSession } from '@/context/SessionContext';
import { useShellUi } from '@/context/ShellUiContext';
import { invoiceBatchesQuery } from '@/lib/api/billing';
import { useApiQuery } from '@/lib/api/query';
import { matchesQuery } from '@/lib/search';
import { loadFailure } from './load-state';

// Runtruck1 pages/app/accounting/BatchesTab.tsx, on GET /invoice-batches
// (docs/api/billing.md §7.3). Counts and totals come from seeded membership (01 C5).
export function BatchesTab() {
  const { query } = useShellUi();
  const { can } = useSession();
  const { data, error } = useApiQuery(invoiceBatchesQuery, { enabled: can('billing.view') });
  const failure = loadFailure(data, error);
  const rows = (data?.data ?? []).map((b) => ({ key: b.id, view: invoiceBatchViewRow(b) })).filter((b) => matchesQuery(b.view, query));

  return (
    <>
      <Kpis items={invoiceBatchesKpis(data?.meta.summary)} />

      <Card title="Invoice batches" flush>
        <table className="ui-table">
          <thead>
            <tr>
              <th>Batch</th><th>Created</th><th className="num">Invoices</th><th>Sent to</th>
              <th className="num">Total</th><th className="num">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, view: b }) => (
              <tr key={key}>
                <td className="strong">{b.id}</td>
                <td>{b.created}</td>
                <td className="num">{b.invoices}</td>
                <td className="muted">{b.sentTo}</td>
                <td className="num">{b.total}</td>
                <td className="num"><Tag label={b.status} tone={b.tone} /></td>
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
