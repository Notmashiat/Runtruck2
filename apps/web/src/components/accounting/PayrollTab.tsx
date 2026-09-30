'use client';

import { EM_DASH, formatMoney, payrollCardTitle, payrollKpis, settlementViewRow } from '@runtruck/calculations';
import { Card, Kpis, Tag } from '@runtruck/ui';
import { useSession } from '@/context/SessionContext';
import { useShellUi } from '@/context/ShellUiContext';
import { useApiQuery } from '@/lib/api/query';
import { currentSettlementsQuery, useApproveSettlements } from '@/lib/api/settlements';
import { matchesQuery } from '@/lib/search';
import { loadFailure } from './load-state';

// Runtruck1 pages/app/accounting/PayrollTab.tsx, on GET /settlements (docs/api/settlements.md
// §5). Runtruck1's in-memory `approved` flag is now server state: "Approve all" persists
// ready → approved through POST /settlements/approve, and `summary.allApproved` drives the
// "Approved" wording. Totals include held and paid rows, as in Runtruck1 (12 §6).
export function PayrollTab() {
  const { query } = useShellUi();
  const { can } = useSession();
  const approveAll = useApproveSettlements();
  const { data, error } = useApiQuery(currentSettlementsQuery, { enabled: can('settlements.view') });
  const failure = loadFailure(data, error);
  const summary = data?.meta.summary;
  const approved = summary?.allApproved ?? false;
  const rows = (data?.data ?? []).map((s) => ({ key: s.id, view: settlementViewRow(s) })).filter((s) => matchesQuery(s.view, query));

  return (
    <>
      <Kpis items={payrollKpis(summary)} />

      <Card
        title={payrollCardTitle(summary?.period)}
        flush
        action={can('settlements.approve', 'settlements.view') ? <button type="button" className="ui-link" onClick={approveAll}>{approved ? 'Approved' : 'Approve all'}</button> : undefined}
      >
        <table className="ui-table">
          <thead>
            <tr>
              <th>Driver</th><th>Pay basis</th><th className="num">Loads</th><th className="num">Miles</th>
              <th className="num">Gross</th><th className="num">Deductions</th><th className="num">Net</th><th className="num">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, view: s }) => (
              <tr key={key}>
                <td className="strong">{s.name}</td>
                <td className="muted">{s.basis}</td>
                <td className="num">{s.loads}</td>
                <td className="num">{s.miles}</td>
                <td className="num">{s.gross}</td>
                <td className="num">{s.ded}</td>
                <td className="num strong">{s.net}</td>
                <td className="num"><Tag label={s.status} tone={s.tone} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {failure !== undefined && <div className="ui-empty">{failure}</div>}
        {data && rows.length === 0 && <div className="ui-empty">Nothing matches “{query}”.</div>}
        <div className="ui-total">Net payable this week <strong>{summary ? formatMoney(summary.netCents) : EM_DASH}</strong></div>
      </Card>
    </>
  );
}
