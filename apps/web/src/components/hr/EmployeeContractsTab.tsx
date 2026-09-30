'use client';

import { employeeContractKpis, toEmployeeContractRow } from '@runtruck/calculations';
import { Card, Kpis, Tag } from '@runtruck/ui';
import { useMemo } from 'react';
import { useSession } from '@/context/SessionContext';
import { useShellUi } from '@/context/ShellUiContext';
import { useEmployeeContracts } from '@/lib/api/hr';
import { queryErrorLine } from '@/lib/api/query';
import { matchesQuery } from '@/lib/search';

// HR › Employee Contracts, ported verbatim from Runtruck1 pages/app/hr/EmployeeContractsTab.tsx
// (docs/reference/runtruck1/fleet-hr-safety.md §6). Data: GET /hr/contracts (docs/api/hr.md
// §4.1); KPIs from meta.summary.

export function EmployeeContractsTab() {
  const { query } = useShellUi();
  const { can } = useSession();
  const contracts = useEmployeeContracts(can('hr.view'));

  const CONTRACTS = useMemo(() => {
    const res = contracts.data;
    return res ? res.data.map((c) => toEmployeeContractRow(c, res.meta.summary.asOf)) : [];
  }, [contracts.data]);
  const KPIS = employeeContractKpis(contracts.data?.meta.summary);
  const error = contracts.data ? null : queryErrorLine(contracts.error);

  const rows = CONTRACTS.filter((c) => matchesQuery(c, query));

  return (
    <>
      <Kpis items={KPIS} />

      <Card title="Employee contracts" flush>
        <table className="ui-table">
          <thead>
            <tr>
              <th>Employee</th><th>Role</th><th>Type</th><th>Start</th><th>Renews</th><th>Pay basis</th><th className="num">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.ref.id}>
                <td className="strong">{c.employee}</td>
                <td>{c.role}</td>
                <td>{c.type}</td>
                <td>{c.start}</td>
                <td>{c.renews}</td>
                <td className="muted">{c.payBasis}</td>
                <td className="num"><Tag label={c.status} tone={c.ref.tone} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {contracts.data && rows.length === 0 && <div className="ui-empty">Nothing matches “{query}”.</div>}
        {error && <div className="ui-empty">{error}</div>}
      </Card>
    </>
  );
}
