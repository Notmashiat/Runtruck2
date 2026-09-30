'use client';

import { claimKpis, formatMoney, toClaimRow } from '@runtruck/calculations';
import { Card, Kpis, Tag } from '@runtruck/ui';
import { useMemo } from 'react';
import { useSession } from '@/context/SessionContext';
import { useShellUi } from '@/context/ShellUiContext';
import { useClaims } from '@/lib/api/safety';
import { queryErrorLine } from '@/lib/api/query';
import { matchesQuery } from '@/lib/search';

// Safety › Settlements (cargo and liability claims), ported verbatim from Runtruck1
// pages/app/safety/ClaimSettlementsTab.tsx (docs/reference/runtruck1/fleet-hr-safety.md §11).
// Data: GET /claims (docs/api/safety.md §7.5); KPIs from meta.summary. The money cells
// format the row's cents.

export function ClaimSettlementsTab() {
  const { query } = useShellUi();
  const { can } = useSession();
  const claims = useClaims(can('claims.view'));

  const CLAIMS = useMemo(() => claims.data?.data.map(toClaimRow) ?? [], [claims.data]);
  const KPIS = claimKpis(claims.data?.meta.summary);
  const error = claims.data ? null : queryErrorLine(claims.error);

  const rows = CLAIMS.filter((c) => matchesQuery(c, query));

  return (
    <>
      <Kpis items={KPIS} />

      <Card title="Claims" flush>
        <table className="ui-table">
          <thead>
            <tr>
              <th>Claim</th><th>Date</th><th>Driver</th><th>Unit</th><th>Type</th><th>Claimant</th>
              <th className="num">Reserved</th><th className="num">Paid</th><th className="num">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.ref.id}>
                <td className="strong">{c.id}</td>
                <td>{c.date}</td>
                <td>{c.driver}</td>
                <td>{c.unit}</td>
                <td>{c.type}</td>
                <td>{c.claimant}</td>
                <td className="num">{formatMoney(c.ref.reservedCents)}</td>
                <td className="num">{c.paid > 0 ? formatMoney(c.ref.paidCents) : '—'}</td>
                <td className="num"><Tag label={c.status} tone={c.ref.tone} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {claims.data && rows.length === 0 && <div className="ui-empty">Nothing matches “{query}”.</div>}
        {error && <div className="ui-empty">{error}</div>}
      </Card>
    </>
  );
}
