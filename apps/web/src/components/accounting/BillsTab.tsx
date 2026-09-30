'use client';

import { billsKpis, billViewRow } from '@runtruck/calculations';
import { Card, Kpis, Tag } from '@runtruck/ui';
import { useSession } from '@/context/SessionContext';
import { useShellUi } from '@/context/ShellUiContext';
import { billsQuery } from '@/lib/api/payables';
import { useApiQuery } from '@/lib/api/query';
import { matchesQuery } from '@/lib/search';
import { loadFailure } from './load-state';

// Runtruck1 pages/app/accounting/BillsTab.tsx, on GET /bills (docs/api/payables.md §4).
export function BillsTab() {
  const { query } = useShellUi();
  const { can } = useSession();
  const { data, error } = useApiQuery(billsQuery, { enabled: can('payables.view') });
  const failure = loadFailure(data, error);
  const rows = (data?.data ?? []).map((b) => ({ key: b.id, view: billViewRow(b) })).filter((b) => matchesQuery(b.view, query));

  return (
    <>
      <Kpis items={billsKpis(data?.meta.summary)} />

      <Card title="Bills" flush>
        <table className="ui-table">
          <thead>
            <tr>
              <th>Vendor</th><th>Category</th><th>Due</th><th className="num">Amount</th><th className="num">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, view: b }) => (
              <tr key={key}>
                <td className="strong">{b.vendor}</td>
                <td className="muted">{b.category}</td>
                <td>{b.due}</td>
                <td className="num">{b.amount}</td>
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
