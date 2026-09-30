'use client';

import { boardStops, type LoadSearchRow, stopTimeLine, toLoadSearchRow } from '@runtruck/calculations';
import type { LoadBoardView } from '@runtruck/types';
import { Card, Kpis, Tag } from '@runtruck/ui';
import { LOAD_BOARD_VIEW_STATUSES } from '@runtruck/validation';
import Link from 'next/link';
import { Fragment, useMemo, useState } from 'react';
import { useSession } from '@/context/SessionContext';
import { type LoadTab, useShellUi } from '@/context/ShellUiContext';
import { useLoadsBoard } from '@/lib/api/loads';
import { queryErrorLine } from '@/lib/api/query';
import { matchesQuery } from '@/lib/search';

// The Loads board, ported verbatim from Runtruck1 pages/app/LoadsPage.tsx
// (docs/reference/runtruck1/core-pages.md §3). Data: GET /loads?view=all&limit=500, filtered
// locally by pill and search over the shared view-model rows; KPIs from meta.summary
// (docs/api/loads.md §8.1).

const TABS: LoadTab[] = ['Active', 'Needs POD', 'Delivered', 'All'];

const TAB_VIEW: Record<LoadTab, LoadBoardView> = { Active: 'active', 'Needs POD': 'needs-pod', Delivered: 'delivered', All: 'all' };

function listFor(loads: LoadSearchRow[], tab: LoadTab): LoadSearchRow[] {
  if (tab === 'All') return loads;
  const statuses: readonly string[] = LOAD_BOARD_VIEW_STATUSES[TAB_VIEW[tab]];
  return loads.filter((l) => statuses.includes(l.load.status));
}

function firstId(list: LoadSearchRow[]): string | null {
  return list.length ? (list[0]?.id ?? null) : null;
}

export function LoadsPage() {
  const { query, setQuery, loadTab, setLoadTab } = useShellUi();
  const { me, can } = useSession();
  const board = useLoadsBoard(can('loads.view'));
  const timeZone = me.organization.timezone;
  const today = me.today;
  const loads = useMemo(() => board.data?.data.map((l) => toLoadSearchRow(l, { timeZone, today })) ?? [], [board.data, timeZone, today]);
  const summary = board.data?.meta.summary;
  const errorLine = board.data ? null : queryErrorLine(board.error);
  const searching = query.trim().length > 0;

  // A search looks across every load, regardless of the filter.
  const rows = searching ? loads.filter((l) => matchesQuery(l, query)) : listFor(loads, loadTab);
  const [openId, setOpenId] = useState<string | null>(firstId(rows));
  // Without prefetched data, expand the first row once when the rows first arrive
  // (Runtruck1's mount-time initializer; core-pages §11 hazard 5).
  const [seeded, setSeeded] = useState(board.data !== undefined);
  if (!seeded && board.data !== undefined) {
    setSeeded(true);
    setOpenId(firstId(rows));
  }

  const countOf = (value: number | undefined) => (value === undefined ? '—' : String(value));
  const kpis = [
    { label: 'Undispatched', value: countOf(summary?.undispatched) },
    { label: 'In transit', value: countOf(summary?.inTransit) },
    { label: 'Delivered', value: countOf(summary?.delivered) },
    { label: 'Needs POD', value: countOf(summary?.needsPod) },
  ];

  const n = board.data ? String(rows.length) : '—';
  const countText = searching ? `${n} matching “${query}”` : `${n} loads`;

  const filter = (
    <div className="ui-filter">
      {TABS.map((o) => (
        <button
          key={o}
          type="button"
          className={`ui-filter-opt${!searching && loadTab === o ? ' is-active' : ''}`}
          onClick={() => {
            setLoadTab(o);
            setQuery('');
            setOpenId(firstId(listFor(loads, o)));
          }}
        >
          {o}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <Kpis items={kpis} />

      <Card flush title={countText} action={filter}>
        <table className="ui-table">
          <thead>
            <tr>
              <th>Load #</th>
              <th>Tender #</th>
              <th>Truck</th>
              <th>Route</th>
              <th>Pickup</th>
              <th>Driver</th>
              <th className="num">Rate</th>
              <th className="num">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const open = openId === l.id;
              const unassigned = l.unit === '—';
              const stops = boardStops(l.stops);
              return (
                <Fragment key={l.id}>
                  <tr
                    className={`is-clickable${open ? ' is-open' : ''}`}
                    onClick={() => {
                      setOpenId(open ? null : l.id);
                    }}
                  >
                    <td className="strong">{l.id}</td>
                    <td className="strong">{l.ref}</td>
                    <td className={unassigned ? 'muted' : ''}>{unassigned ? 'Unassigned' : l.unit}</td>
                    <td>{l.route}</td>
                    <td>{l.pickup}</td>
                    <td>{l.driver}</td>
                    <td className="num">{l.rate}</td>
                    <td className="num">
                      <Tag label={l.status} tone={l.tone} />
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={8} className="ui-expand-cell">
                        <div className="ui-expand">
                          <div>
                            <div className="ui-label">Stops ({stops.length})</div>
                            {stops.map((s, i) => (
                              <div key={i} className="ui-stop">
                                <div className={`ui-stop-kind ${s.kind === 'pickup' ? 'pickup' : 'delivery'}`}>
                                  {s.kind === 'pickup' ? 'Pickup' : 'Delivery'} · Stop {i + 1}
                                </div>
                                <div className="ui-stop-name">{s.facilityName}</div>
                                <div className="ui-stop-meta">{s.addressLabel ?? ''}</div>
                                <div className="ui-stop-meta">{stopTimeLine(s)}</div>
                              </div>
                            ))}
                          </div>

                          <div>
                            <div className="ui-label">Load details</div>
                            <div className="ui-kv">
                              {[
                                ['System load #', l.id],
                                ['Tender #', l.ref],
                                ['Commodity', l.commodity],
                                ['Weight', l.weight],
                                ['Equipment', l.equip],
                                ['Rate', l.rate],
                              ].map(([k, v]) => (
                                <div key={k}>
                                  <div className="ui-label">{k}</div>
                                  <div className="ui-kv-value">{v}</div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div>
                            <div className="ui-label">Customer</div>
                            <div className="ui-kv">
                              <div>
                                <div className="ui-kv-value">{l.customer}</div>
                                <div className="ui-stop-meta">
                                  {l.temp} · {l.equip}
                                </div>
                              </div>
                              <div>
                                <Link className="ui-link" href={`/app/loads/${l.id}`} scroll={false}>
                                  Open load →
                                </Link>
                              </div>
                            </div>
                          </div>

                          <div>
                            <div className="ui-label">Truck &amp; driver</div>
                            <div className="ui-kv">
                              <div>
                                <div className="ui-label">Truck</div>
                                <div className="ui-kv-value">{unassigned ? 'Unassigned' : l.unit}</div>
                              </div>
                              <div>
                                <div className="ui-label">Driver</div>
                                <div className="ui-kv-value">{l.driver}</div>
                              </div>
                            </div>
                            <div className="ui-label" style={{ marginTop: 22 }}>
                              Carrier
                            </div>
                            <div className="ui-kv">
                              <div>
                                <div className="ui-label">Name</div>
                                <div className="ui-kv-value">{l.carrier}</div>
                              </div>
                              <div>
                                <div className="ui-label">MC · DOT</div>
                                <div className="ui-kv-value">
                                  {l.carrierMc} · {l.carrierDot}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {board.data && rows.length === 0 && <div className="ui-empty">{searching ? `Nothing matches “${query}”.` : 'No loads in this view.'}</div>}
        {errorLine && <div className="ui-empty">{errorLine}</div>}
      </Card>
    </>
  );
}
