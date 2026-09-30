'use client';

import {
  formatActivityTime,
  LOAD_DOCUMENT_STATUS_LABEL,
  LOAD_DOCUMENT_STATUS_TONE,
  LOAD_DOCUMENT_TYPE_LABEL,
  stopKindClass,
  stopKindLabel,
  stopTimeLine,
  toLoadSearchRow,
} from '@runtruck/calculations';
import type { LoadDetail } from '@runtruck/types';
import { Card, Kpis, Tag } from '@runtruck/ui';
import { useParams } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useSession } from '@/context/SessionContext';
import { ApiError } from '@/lib/api/client';
import { firstBoardLoadQuery, loadByIdQuery, loadByNumberQuery, loadNumberFromParam } from '@/lib/api/loads';
import { queryErrorLine, useApiQuery } from '@/lib/api/query';

// The load detail page, ported verbatim from Runtruck1 pages/app/LoadDetailPage.tsx
// (docs/reference/runtruck1/core-pages.md §4). Every load renders through the same rules
// (D7): stops, documents and activity are real rows (docs/api/loads.md §8.2).

// `missingOnServer`: the server page already got 404 LOAD_NOT_FOUND for this number and
// hydrated the fallback, so the first paint shows it without asking again.
function useSelectedLoad(param: string, missingOnServer: boolean) {
  const { can } = useSession();
  const canView = can('loads.view');
  const n = loadNumberFromParam(param);
  const byNumber = useApiQuery(loadByNumberQuery(n ?? 0), { enabled: canView && n !== null && !missingOnServer });
  const notFound = missingOnServer || (byNumber.error instanceof ApiError && byNumber.error.code === 'LOAD_NOT_FOUND');
  const fallback = n === null || notFound || (byNumber.data !== undefined && byNumber.data.data.archivedAt !== null);
  const first = useApiQuery(firstBoardLoadQuery, { enabled: canView && fallback });
  const firstId = first.data?.data[0]?.id;
  const byId = useApiQuery(loadByIdQuery(firstId ?? ''), { enabled: canView && fallback && firstId !== undefined });

  if (!fallback) return { load: byNumber.data?.data, error: byNumber.data ? null : byNumber.error, emptyBoard: false };
  const failed = first.data ? byId.error : first.error;
  return { load: byId.data?.data, error: byId.data ? null : failed, emptyBoard: first.data !== undefined && first.data.data.length === 0 };
}

export function LoadDetailPage({ missingOnServer = false }: { missingOnServer?: boolean }) {
  const params = useParams<{ loadNumber: string }>();
  const { me, can } = useSession();
  const { load: sel, error, emptyBoard } = useSelectedLoad(params.loadNumber, missingOnServer);

  // Runtruck1 would crash on an empty board; the page renders nothing (01 §6 C8).
  if (emptyBoard) return null;
  return sel ? (
    <LoadDetailView sel={sel} timeZone={me.organization.timezone} today={me.today} />
  ) : (
    <LoadDetailStructure errorLine={queryErrorLine(error)} showDocuments={can('documents.view')} />
  );
}

const rowStyle = (i: number): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '10px 0',
  borderTop: i ? '1px solid var(--ui-border)' : 0,
});

const kv = (rows: { k: string; v: string }[]) => (
  <div className="ui-kv" style={{ marginTop: 0 }}>
    {rows.map((f) => (
      <div key={f.k}>
        <div className="ui-label">{f.k}</div>
        <div className="ui-kv-value">{f.v}</div>
      </div>
    ))}
  </div>
);

function LoadDetailView({ sel: load, timeZone, today }: { sel: LoadDetail; timeZone: string; today: string }) {
  const sel = toLoadSearchRow(load, { timeZone, today });

  const stops = load.stops.map((s) => ({
    kind: stopKindLabel(s.kind, s.status),
    kindClass: stopKindClass(s.kind),
    name: s.facilityName,
    address: s.addressLabel ?? '',
    window: stopTimeLine(s),
  }));

  const facts: { k: string; v: string; note?: string }[] = [
    { k: 'Miles', v: sel.miles },
    { k: 'Line haul', v: sel.rate, note: sel.rpm === '—' ? undefined : `${sel.rpm} / mi` },
    { k: load.payKind === 'carrier_cost' ? 'Carrier cost' : 'Driver pay', v: sel.pay },
    { k: 'Margin', v: sel.margin },
  ];
  const freight = [
    ...(sel.mode ? [{ k: 'Mode', v: sel.mode }] : []),
    { k: 'Commodity', v: sel.commodity },
    { k: 'Weight', v: sel.weight },
    { k: 'Equipment', v: sel.equip },
    { k: 'Temperature', v: sel.temp },
    { k: 'Reference', v: sel.ref },
    ...(sel.ltl ? [{ k: 'LTL', v: sel.ltl }] : []),
  ];
  const carrier = [
    { k: 'Carrier', v: sel.carrier },
    { k: 'MC #', v: sel.carrierMc },
    { k: 'DOT #', v: sel.carrierDot },
    ...(sel.carrierRate ? [{ k: 'Carrier rate', v: sel.carrierRate }] : []),
  ];
  const docs = load.documents?.map((d) => ({
    name: LOAD_DOCUMENT_TYPE_LABEL[d.documentType],
    state: LOAD_DOCUMENT_STATUS_LABEL[d.status],
    tone: LOAD_DOCUMENT_STATUS_TONE[d.status],
  }));
  const activity = load.activity.map((a) => ({ when: formatActivityTime(a.occurredAt, timeZone, today), what: a.message }));

  return (
    <>
      <Card>
        <h2 className="ui-h2" style={{ margin: 0 }}>
          {sel.route}
        </h2>
        <div style={{ marginTop: 6, fontSize: 14, color: 'var(--ui-muted)' }}>
          Load {sel.id} · {sel.customer} · {sel.status}
        </div>
      </Card>

      <Kpis items={facts.map((f) => ({ label: f.k, value: f.v, note: f.note }))} />

      <div className="ui-grid-2">
        <Card title="Stops">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {stops.map((s, i) => (
              <div key={i} className="ui-stop">
                <div className={`ui-stop-kind${s.kindClass ? ` ${s.kindClass}` : ''}`}>{s.kind}</div>
                <div className="ui-stop-name">{s.name}</div>
                <div className="ui-stop-meta">{s.address}</div>
                <div className="ui-stop-meta">{s.window}</div>
              </div>
            ))}
          </div>
          <div className="ui-placeholder" style={{ marginTop: 20 }}>
            Live map / ELD trace
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <Card title="Freight & pay">{kv(freight)}</Card>

          <Card title="Carrier">{kv(carrier)}</Card>

          {docs && (
            <Card title="Documents">
              {docs.map((d, i) => (
                <div key={d.name} style={rowStyle(i)}>
                  <div style={{ flex: 1 }}>{d.name}</div>
                  <Tag label={d.state} tone={d.tone} />
                </div>
              ))}
            </Card>
          )}

          <Card title="Activity">
            {activity.map((a, i) => (
              <div key={i} style={rowStyle(i)}>
                <div style={{ width: 96, flex: 'none', fontSize: 13, color: 'var(--ui-muted)', fontVariantNumeric: 'tabular-nums' }}>{a.when}</div>
                <div style={{ flex: 1 }}>{a.what}</div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </>
  );
}

// Pending, refused (403) or failed (implementation-brief §4 rules 2–4): the page's
// structure with KPI values "—", no rows, and one `ui-empty` line for a failure other
// than a refusal, in the first card.
function LoadDetailStructure({ errorLine, showDocuments }: { errorLine: string | null; showDocuments: boolean }) {
  return (
    <>
      <Card>
        <h2 className="ui-h2" style={{ margin: 0 }} />
        <div style={{ marginTop: 6, fontSize: 14, color: 'var(--ui-muted)' }} />
        {errorLine && <div className="ui-empty">{errorLine}</div>}
      </Card>

      <Kpis
        items={[
          { label: 'Miles', value: '—' },
          { label: 'Line haul', value: '—' },
          { label: 'Driver pay', value: '—' },
          { label: 'Margin', value: '—' },
        ]}
      />

      <div className="ui-grid-2">
        <Card title="Stops">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} />
          <div className="ui-placeholder" style={{ marginTop: 20 }}>
            Live map / ELD trace
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <Card title="Freight & pay">{kv([])}</Card>
          <Card title="Carrier">{kv([])}</Card>
          {showDocuments && <Card title="Documents">{null}</Card>}
          <Card title="Activity">{null}</Card>
        </div>
      </div>
    </>
  );
}
