'use client';

import { toTrailerRow, trailerKpis } from '@runtruck/calculations';
import { Card, Kpis, Tag } from '@runtruck/ui';
import { useMemo } from 'react';
import { useSession } from '@/context/SessionContext';
import { useShellUi } from '@/context/ShellUiContext';
import { useTrailers } from '@/lib/api/fleet';
import { queryErrorLine } from '@/lib/api/query';
import { matchesQuery } from '@/lib/search';

// Fleet › Trailers, ported verbatim from Runtruck1 pages/app/fleet/TrailersTab.tsx
// (docs/reference/runtruck1/fleet-hr-safety.md §5). Data: GET /trailers (docs/api/fleet.md
// §5.3); KPIs from meta.summary.

export function TrailersTab() {
  const { query } = useShellUi();
  const { can } = useSession();
  const trailers = useTrailers(can('trailers.view'));

  const TRAILERS = useMemo(() => trailers.data?.data.map(toTrailerRow) ?? [], [trailers.data]);
  const KPIS = trailerKpis(trailers.data?.meta.summary);
  const error = trailers.data ? null : queryErrorLine(trailers.error);

  const rows = TRAILERS.filter((t) => matchesQuery(t, query));

  return (
    <>
      <Kpis items={KPIS} />

      <Card title="Trailers" flush>
        <table className="ui-table">
          <thead>
            <tr>
              <th>Unit</th>
              <th>Type</th>
              <th>Status</th>
              <th>Location</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.ref.id}>
                <td className="strong">{t.unit}</td>
                <td>{t.kind}</td>
                <td>
                  <Tag label={t.status} tone={t.ref.tone} />
                </td>
                <td>{t.where}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {trailers.data && rows.length === 0 && <div className="ui-empty">Nothing matches “{query}”.</div>}
        {error && <div className="ui-empty">{error}</div>}
      </Card>
    </>
  );
}
