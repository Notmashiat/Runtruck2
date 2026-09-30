'use client';

import { driverDocumentKpis, toDriverDocumentRow } from '@runtruck/calculations';
import { Card, Kpis, Tag } from '@runtruck/ui';
import { useMemo } from 'react';
import { useSession } from '@/context/SessionContext';
import { useShellUi } from '@/context/ShellUiContext';
import { useDriverDocuments } from '@/lib/api/safety';
import { queryErrorLine } from '@/lib/api/query';
import { matchesQuery } from '@/lib/search';

// Safety › Driver Documents, ported verbatim from Runtruck1 pages/app/safety/DriverDocumentsTab.tsx
// (docs/reference/runtruck1/fleet-hr-safety.md §9). Data: GET /driver-documents
// (docs/api/safety.md §7.2); KPIs from meta.summary.

export function DriverDocumentsTab() {
  const { query } = useShellUi();
  const { can } = useSession();
  const documents = useDriverDocuments(can('compliance.view'));

  const DRIVER_DOCUMENTS = useMemo(() => documents.data?.data.map(toDriverDocumentRow) ?? [], [documents.data]);
  const KPIS = driverDocumentKpis(documents.data?.meta.summary);
  const error = documents.data ? null : queryErrorLine(documents.error);

  const rows = DRIVER_DOCUMENTS.filter((d) => matchesQuery(d, query));

  return (
    <>
      <Kpis items={KPIS} />

      <Card title="Driver qualification files" flush>
        <table className="ui-table">
          <thead>
            <tr>
              <th>Driver</th><th>Document</th><th>Expires</th><th className="num">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.ref.id}>
                <td className="strong">{d.driver}</td>
                <td>{d.document}</td>
                <td>{d.expires}</td>
                <td className="num"><Tag label={d.status} tone={d.ref.tone} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {documents.data && rows.length === 0 && <div className="ui-empty">Nothing matches “{query}”.</div>}
        {error && <div className="ui-empty">{error}</div>}
      </Card>
    </>
  );
}
