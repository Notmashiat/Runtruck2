'use client';

import { toViolationRow, violationKpis } from '@runtruck/calculations';
import { Card, Kpis, Tag } from '@runtruck/ui';
import { useMemo } from 'react';
import { useSession } from '@/context/SessionContext';
import { useShellUi } from '@/context/ShellUiContext';
import { useViolations } from '@/lib/api/safety';
import { queryErrorLine } from '@/lib/api/query';
import { matchesQuery } from '@/lib/search';

// Safety › Violations, ported verbatim from Runtruck1 pages/app/safety/ViolationsTab.tsx
// (docs/reference/runtruck1/fleet-hr-safety.md §10). Data: GET /violations
// (docs/api/safety.md §7.4); KPIs from meta.summary. The date cell is plain, not strong (D6).

export function ViolationsTab() {
  const { query } = useShellUi();
  const { can } = useSession();
  const violations = useViolations(can('compliance.view'));

  const VIOLATIONS = useMemo(() => violations.data?.data.map(toViolationRow) ?? [], [violations.data]);
  const KPIS = violationKpis(violations.data?.meta.summary);
  const error = violations.data ? null : queryErrorLine(violations.error);

  const rows = VIOLATIONS.filter((v) => matchesQuery(v, query));

  return (
    <>
      <Kpis items={KPIS} />

      <Card title="Roadside inspections & violations" flush>
        <table className="ui-table">
          <thead>
            <tr>
              <th>Date</th><th>Driver</th><th>Unit</th><th>Type</th><th className="num">Points</th><th>Location</th><th className="num">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.ref.id}>
                <td>{v.date}</td>
                <td className="strong">{v.driver}</td>
                <td>{v.unit}</td>
                <td>{v.type}</td>
                <td className="num">{v.severityPoints}</td>
                <td className="muted">{v.location}</td>
                <td className="num"><Tag label={v.status} tone={v.ref.tone} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {violations.data && rows.length === 0 && <div className="ui-empty">Nothing matches “{query}”.</div>}
        {error && <div className="ui-empty">{error}</div>}
      </Card>
    </>
  );
}
