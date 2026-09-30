'use client';

import { plannerDeleteCodeConfirm, plannerSearchRow, plannerValueOf, toPlannerCategory, toPlannerEventVm } from '@runtruck/calculations';
import type { ApiSuccess, PlannerColorCodeDto, PlannerColorCodesMeta, PlannerRelatedLoadDto } from '@runtruck/types';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type CSSProperties, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '@/context/SessionContext';
import { useShellUi } from '@/context/ShellUiContext';
import {
  patchColorCode,
  plannerColorCodesQuery,
  plannerRange,
  plannerWriteError,
  toPlannerEventBody,
  useAddColorCode,
  useDeleteColorCode,
  useDeletePlannerEvent,
  usePlannerColorCodes,
  usePlannerEvents,
  usePlannerStopValues,
  useRecolorColorCode,
  useResetPlanner,
  useSavePlannerEvent,
} from '@/lib/api/planner';
import { invalidate, queryErrorLine } from '@/lib/api/query';
import { addDays, addMonths, formatTime, fromIso, iso, MONTHS, shortLabel, startOfWeek, toHhmm, toMinutes, WEEKDAYS } from '@/lib/dates';
import { usePersisted } from '@/lib/persist';
import { matchesQuery } from '@/lib/search';
import { CalendarSettings, type SettingsPage } from './CalendarSettings';
import { EventDialog } from './EventDialog';
import {
  type CalView,
  type CardField,
  type Category,
  DEFAULT_PREFS,
  type PlannerEvent,
  type Prefs,
  PREFS_KEY,
  revivePrefs,
  ROW_H,
  TONES,
} from './planner-data';

// The Planner, ported verbatim from Runtruck1 pages/app/PlannerPage.tsx (docs/reference/
// runtruck1/planner.md; docs/api/planner.md §7). The layout, occurrence expansion, lane
// layout, geometry, colour logic and card lines are Runtruck1's. Only the data changed: events,
// color codes, stop values and related loads come from the API (TanStack Query), "today" is
// the organization's business date (GET /me), and every business write goes through the API.
// View preferences stay in the browser (runtruck-planner-prefs, D8).

const VIEWS: CalView[] = ['Day', 'Week', 'Month'];

// One event as drawn on one day: all-day spans become a chip on each day they cover.
interface Occurrence {
  ev: PlannerEvent;
  date: string;
  start: number;
  end: number;
  allDay: boolean;
}

// How the grids draw an event: its color and the lines on its card.
interface Look {
  tone: (ev: PlannerEvent) => string;
  lines: (o: Occurrence) => string[];
}

type ColorCodesCache = ApiSuccess<PlannerColorCodeDto[], PlannerColorCodesMeta>;

function occurrencesOn(events: PlannerEvent[], date: string): Occurrence[] {
  return events
    .filter((e) => (e.start ? e.date === date : e.date <= date && date <= (e.endDate ?? e.date)))
    .map((ev) => ({
      ev,
      date,
      start: ev.start ? toMinutes(ev.start) : 0,
      end: ev.start ? Math.max(toMinutes(ev.end ?? ev.start), toMinutes(ev.start) + 15) : 24 * 60,
      allDay: !ev.start,
    }))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start || b.end - a.end);
}

// Overlapping timed events share the column: each gets a lane and the lane count of its cluster.
function layout(occ: Occurrence[]) {
  const out: { o: Occurrence; lane: number; lanes: number }[] = [];
  let cluster: { o: Occurrence; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    cluster.forEach((c) => out.push({ ...c, lanes: laneEnds.length }));
    cluster = [];
    laneEnds = [];
  };
  for (const o of occ) {
    if (o.start >= clusterEnd) {
      flush();
      clusterEnd = -1;
    }
    let lane = laneEnds.findIndex((end) => end <= o.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(o.end);
    } else {
      laneEnds[lane] = o.end;
    }
    cluster.push({ o, lane });
    clusterEnd = Math.max(clusterEnd, o.end);
  }
  flush();
  return out;
}

export function PlannerPage() {
  const { query } = useShellUi();
  const { me, can } = useSession();
  const TODAY = me.today;
  const canView = can('planner.view');
  const canManage = can('planner.manage');
  const canConfigure = can('planner.configure');
  const [prefs, setPrefs] = usePersisted<Prefs>(PREFS_KEY, DEFAULT_PREFS, revivePrefs);
  const [cursor, setCursor] = useState(() => fromIso(TODAY));
  const [selected, setSelected] = useState<{ o: Occurrence; x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<{ ev: PlannerEvent; isNew: boolean } | null>(null);
  const [settings, setSettings] = useState<SettingsPage | null>(null);

  const pref = <K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs((p) => ({ ...p, [key]: value }));
  };
  const { view, colorBy } = prefs;
  const byValue = colorBy !== 'type';
  const time = (min: number) => formatTime(min, prefs.hour24);

  // — data (docs/api/planner.md §7.1) —
  const eventsQuery = usePlannerEvents(plannerRange(view, cursor, prefs.weekStart), canView);
  const codesQuery = usePlannerColorCodes(canView);
  const stopValuesQuery = usePlannerStopValues(canView);
  const events = useMemo(() => eventsQuery.data?.data.map(toPlannerEventVm) ?? [], [eventsQuery.data]);
  const categories = useMemo(() => codesQuery.data?.data.map(toPlannerCategory) ?? [], [codesQuery.data]);
  const stopValues = stopValuesQuery.data?.data;
  // The grid shows the range's final layout: its events, or the page's refusal/error state
  // (without planner.view the read is never sent and renders like a refusal).
  const eventsSettled = !canView || eventsQuery.data !== undefined || eventsQuery.error !== null;
  const failure =
    (eventsQuery.data ? null : queryErrorLine(eventsQuery.error)) ??
    (codesQuery.data ? null : queryErrorLine(codesQuery.error)) ??
    (stopValuesQuery.data ? null : queryErrorLine(stopValuesQuery.error));

  // — colors —
  // The API returns Runtruck1's `all` order: office events, then load-stop events (§2.5).
  const all = events;
  const catOf = new Map(categories.map((c) => [c.key, c]));
  const values = byValue ? (stopValues?.[colorBy] ?? []) : [];
  const valueTone = (v: string) => prefs.valueTones[`${colorBy}:${v}`] ?? TONES[values.indexOf(v) % TONES.length] ?? 'undefined';
  const colorKey = (ev: PlannerEvent) => (byValue && ev.readOnly ? `${colorBy}:${plannerValueOf(ev, colorBy)}` : ev.category);
  const look: Look = {
    tone: (ev) => (byValue && ev.readOnly ? valueTone(plannerValueOf(ev, colorBy)) : (catOf.get(ev.category)?.tone ?? 'slate')),
    lines: (o) => {
      const field = (f: CardField): string => {
        const ev = o.ev;
        const map: Record<CardField, string | undefined> = {
          place: ev.place,
          title: ev.title,
          category: catOf.get(ev.category)?.label ?? 'Uncategorized',
          time: o.allDay ? 'All day' : `${time(o.start)} – ${time(o.end)}`,
          load: ev.loadId,
          driver: ev.driver ?? ev.people?.[0],
          truck: ev.truck,
          customer: ev.customer,
          facility: ev.facility,
          commodity: ev.commodity,
          none: '',
        };
        return map[f] ?? '';
      };
      const [first = 'none', ...rest] = prefs.cardLines;
      return [field(first) || o.ev.title, ...rest.map(field).filter(Boolean)];
    },
  };

  // Legend chips double as show / hide filters.
  const legend = byValue
    ? [
        ...categories.filter((c) => !c.locked).map((c) => ({ key: c.key, label: c.label, tone: c.tone })),
        ...values.map((v) => ({ key: `${colorBy}:${v}`, label: v, tone: valueTone(v) })),
      ]
    : categories.map((c) => ({ key: c.key, label: c.label, tone: c.tone }));

  const shown = all.filter((e) => !prefs.hidden.includes(colorKey(e)) && matchesQuery(plannerSearchRow(e), query));

  // — writes (docs/api/planner.md §7.5): a failed or refused write alerts and changes nothing —
  const queryClient = useQueryClient();
  const saveEventMutation = useSavePlannerEvent();
  const deleteEventMutation = useDeletePlannerEvent();
  const addCodeMutation = useAddColorCode();
  const recolorMutation = useRecolorColorCode();
  const deleteCodeMutation = useDeleteColorCode();
  const resetMutation = useResetPlanner();

  const attempt = async (write: () => Promise<unknown>): Promise<boolean> => {
    try {
      await write();
      return true;
    } catch (err) {
      window.alert(plannerWriteError(err));
      return false;
    }
  };

  // Runtruck1 removed an event or a code at once; here the popover and the code row stay on
  // screen until the API answers, so a repeated click on the same Delete is ignored meanwhile
  // (it would otherwise send a second DELETE and alert "…was not found.").
  const inFlight = useRef(new Set<string>());
  const once = (key: string, write: () => Promise<boolean>): Promise<boolean> => {
    if (inFlight.current.has(key)) return Promise.resolve(false);
    inFlight.current.add(key);
    return write().finally(() => {
      inFlight.current.delete(key);
    });
  };

  const saveEvent = (ev: PlannerEvent, isNew: boolean, relatedLoads: readonly PlannerRelatedLoadDto[]) =>
    attempt(() => saveEventMutation.mutateAsync({ id: isNew ? null : ev.id, body: toPlannerEventBody(ev, categories, relatedLoads) }));
  const deleteEvent = (ev: PlannerEvent) => once(`event:${ev.id}`, () => attempt(() => deleteEventMutation.mutateAsync(ev.id)));

  // Code renames are optimistic: the cache (and so the legend) follows every keystroke, the
  // PATCH is debounced 400 ms and flushed on blur, and the server's answer is written back only
  // while the name is not being edited (decision P8).
  const renameTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingLabels = useRef(new Map<string, string>());
  const focusedCode = useRef<string | null>(null);

  const setCachedCode = useCallback(
    (id: string, patch: Partial<PlannerColorCodeDto>) =>
      queryClient.setQueryData<ColorCodesCache>(plannerColorCodesQuery.queryKey, (old) =>
        old ? { ...old, data: old.data.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : old,
      ),
    [queryClient],
  );

  const flushLabel = useCallback(
    (id: string) => {
      clearTimeout(renameTimers.current.get(id));
      renameTimers.current.delete(id);
      const label = pendingLabels.current.get(id);
      if (label === undefined) return;
      pendingLabels.current.delete(id);
      patchColorCode(id, { label }).then(
        ({ data }) => {
          if (focusedCode.current !== id && !pendingLabels.current.has(id)) setCachedCode(id, data);
        },
        (err: unknown) => {
          window.alert(plannerWriteError(err));
          void invalidate(queryClient, plannerColorCodesQuery.queryKey);
        },
      );
    },
    [queryClient, setCachedCode],
  );

  // Leaving the page sends any rename still waiting for its debounce.
  useEffect(() => {
    const timers = renameTimers.current;
    const pending = pendingLabels.current;
    return () => {
      for (const id of [...pending.keys()]) {
        clearTimeout(timers.get(id));
        void patchColorCode(id, { label: pending.get(id) ?? '' }).catch(() => undefined);
      }
      pending.clear();
      timers.clear();
    };
  }, []);

  // — color code edits —
  const updateCategory = (key: string, patch: Partial<Pick<Category, 'label' | 'tone'>>) => {
    const code = catOf.get(key);
    if (!code || !canConfigure) return;
    if (patch.label !== undefined) {
      const id = code.id;
      setCachedCode(id, { label: patch.label });
      pendingLabels.current.set(id, patch.label);
      clearTimeout(renameTimers.current.get(id));
      renameTimers.current.set(
        id,
        setTimeout(() => {
          flushLabel(id);
        }, 400),
      );
    }
    if (patch.tone !== undefined) {
      const tone = patch.tone;
      void attempt(() => recolorMutation.mutateAsync({ id: code.id, tone }));
    }
  };
  const addCategory = () => {
    void attempt(() => addCodeMutation.mutateAsync());
  };
  const deleteCategory = (key: string) => {
    const gone = categories.find((c) => c.key === key);
    const fallback = categories.find((c) => !c.locked && c.key !== key);
    if (!gone || !fallback) {
      window.alert('Keep at least one color code for your own events.');
      return;
    }
    if (inFlight.current.has(`code:${gone.id}`)) return;
    const n = gone.eventCount;
    if (n && !window.confirm(plannerDeleteCodeConfirm(gone.label, n, fallback.label))) return;
    void once(`code:${gone.id}`, () => attempt(() => deleteCodeMutation.mutateAsync(gone.id))).then((ok) => {
      if (ok) setPrefs((p) => ({ ...p, hidden: p.hidden.filter((k) => k !== key) }));
    });
  };
  // Reset restores the organization's calendar through the API (D8, planner.reset); the
  // browser prefs go back to the defaults only when the API accepted it (decision P7).
  const resetCalendar = () => {
    void attempt(() => resetMutation.mutateAsync()).then((ok) => {
      if (ok) setPrefs(DEFAULT_PREFS);
    });
  };

  // — columns on screen —
  const weekDays = (from: Date) =>
    Array.from({ length: 7 }, (_, i) => addDays(from, i)).filter((d) => prefs.showWeekends || (d.getDay() !== 0 && d.getDay() !== 6));
  let days: Date[] = [];
  const weeks: Date[][] = [];
  if (view === 'Day') days = [cursor];
  if (view === 'Week') days = weekDays(startOfWeek(cursor, prefs.weekStart));
  if (view === 'Month') {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    for (let w = startOfWeek(first, prefs.weekStart); w.getMonth() === first.getMonth() || w < first; w = addDays(w, 7)) {
      const week = weekDays(w);
      if (week.length) weeks.push(week);
    }
  }

  const move = (dir: 1 | -1) => {
    setSelected(null);
    setCursor((c) => (view === 'Day' ? addDays(c, dir) : view === 'Week' ? addDays(c, 7 * dir) : addMonths(c, dir)));
  };
  const openDay = (d: Date) => {
    setCursor(d);
    pref('view', 'Day');
    setSelected(null);
  };
  const create = (date: string, startMin?: number) => {
    setSelected(null);
    // Creating needs planner.manage (§7.6); without it slots and cells do nothing.
    if (!canManage) return;
    const s = startMin ?? 9 * 60;
    const category = categories.find((c) => !c.locked)?.key ?? 'meeting';
    setEditing({
      isNew: true,
      ev: { id: `ev-${Date.now()}`, title: '', category, date, start: toHhmm(s), end: toHhmm(Math.min(s + 60, 23 * 60 + 45)) },
    });
  };
  const select = (o: Occurrence, e: MouseEvent) => {
    e.stopPropagation();
    setSelected({ o, x: e.clientX, y: e.clientY });
  };

  const monthName = MONTHS[cursor.getMonth()] ?? '';
  const title =
    view === 'Day'
      ? `${WEEKDAYS[cursor.getDay()]}, ${monthName} ${cursor.getDate()}, ${cursor.getFullYear()}`
      : `${monthName} ${cursor.getFullYear()}`;
  // Until the range's events are loaded the month count reads "—" (implementation-brief §4 rule 2).
  const monthCount = eventsQuery.data ? String(shown.filter((e) => e.date.startsWith(iso(cursor).slice(0, 7))).length) : '—';
  const range =
    view === 'Week' && days.length
      ? `${shortLabel(days[0] ?? cursor)} – ${shortLabel(days[days.length - 1] ?? cursor)}`
      : view === 'Month'
        ? `${monthCount} events this month`
        : '';

  // A sample load stop for the Event cards preview (GET /planner/stop-values, §3.9).
  const sampleEv = stopValues?.sampleEvent ? toPlannerEventVm(stopValues.sampleEvent) : undefined;
  const sampleOcc = sampleEv && occurrencesOn([sampleEv], sampleEv.date)[0];

  return (
    <>
      <div className="cal-toolbar">
        <div className="cal-badge">
          <span>{monthName.slice(0, 3)}</span>
          <strong>{cursor.getDate()}</strong>
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="cal-title">{title}</div>
          {range && <div className="cal-range">{range}</div>}
        </div>
        <div style={{ flex: 1 }} />
        <div className="cal-nav">
          <button
            type="button"
            className="ui-btn"
            onClick={() => {
              move(-1);
            }}
            aria-label={`Previous ${view.toLowerCase()}`}
          >
            ‹
          </button>
          <button
            type="button"
            className="ui-btn"
            onClick={() => {
              setCursor(fromIso(TODAY));
              setSelected(null);
            }}
          >
            Today
          </button>
          <button
            type="button"
            className="ui-btn"
            onClick={() => {
              move(1);
            }}
            aria-label={`Next ${view.toLowerCase()}`}
          >
            ›
          </button>
        </div>
        <div className="ui-filter" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              className={`ui-filter-opt${view === v ? ' is-active' : ''}`}
              onClick={() => {
                pref('view', v);
                setSelected(null);
              }}
            >
              {v}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="ui-btn"
          onClick={() => {
            setSettings('Layout');
          }}
        >
          Customize
        </button>
        {canManage && (
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            onClick={() => {
              create(iso(cursor));
            }}
          >
            + Add Event
          </button>
        )}
      </div>

      <div className="cal-legend">
        {legend.map((c) => {
          const on = !prefs.hidden.includes(c.key);
          return (
            <button
              key={c.key}
              type="button"
              className={`cal-legend-item${on ? '' : ' is-off'}`}
              aria-pressed={on}
              onClick={() => {
                pref('hidden', on ? [...prefs.hidden, c.key] : prefs.hidden.filter((k) => k !== c.key));
              }}
            >
              <span className={`cal-dot t-${c.tone}`} />
              {c.label}
            </button>
          );
        })}
        <button
          type="button"
          className="ui-link cal-legend-edit"
          onClick={() => {
            setSettings('Color codes');
          }}
        >
          Edit colors
        </button>
      </div>

      {view === 'Month' ? (
        <MonthGrid
          weeks={weeks}
          month={cursor.getMonth()}
          events={shown}
          look={look}
          time={time}
          today={TODAY}
          failure={failure}
          onOpenDay={openDay}
          onCreate={create}
          onSelect={select}
        />
      ) : (
        <TimeGrid
          days={days}
          events={shown}
          prefs={prefs}
          look={look}
          time={time}
          today={TODAY}
          failure={failure}
          settled={eventsSettled}
          onOpenDay={view === 'Week' ? openDay : undefined}
          onCreate={create}
          onSelect={select}
        />
      )}

      {selected && (
        <EventPopover
          sel={selected}
          look={look}
          time={time}
          category={catOf.get(selected.o.ev.category)}
          canManage={canManage}
          onClose={() => {
            setSelected(null);
          }}
          onEdit={() => {
            setEditing({ ev: selected.o.ev, isNew: false });
            setSelected(null);
          }}
          onDelete={() => {
            const deleted = selected.o.ev.id;
            void deleteEvent(selected.o.ev).then((ok) => {
              // Close this event's popover only (another may have been opened meanwhile).
              if (ok) setSelected((s) => (s?.o.ev.id === deleted ? null : s));
            });
          }}
        />
      )}

      {editing && (
        <EventDialog
          event={editing.ev}
          categories={categories}
          isNew={editing.isNew}
          onClose={() => {
            setEditing(null);
          }}
          onDelete={() => deleteEvent(editing.ev)}
          onSave={(ev, relatedLoads) => saveEvent(ev, editing.isNew, relatedLoads)}
        />
      )}

      {settings && (
        <CalendarSettings
          page={settings}
          prefs={prefs}
          pref={pref}
          categories={categories}
          onCategory={updateCategory}
          onCategoryFocus={(key) => {
            focusedCode.current = catOf.get(key)?.id ?? null;
          }}
          onCategoryBlur={(key) => {
            focusedCode.current = null;
            const id = catOf.get(key)?.id;
            if (id) flushLabel(id);
          }}
          onAddCategory={addCategory}
          onDeleteCategory={deleteCategory}
          canConfigure={canConfigure}
          values={values}
          valueTone={valueTone}
          sample={sampleOcc ? { lines: look.lines(sampleOcc), tone: look.tone(sampleOcc.ev) } : { lines: ['Fresno, CA'], tone: 'amber' }}
          onReset={resetCalendar}
          onClose={() => {
            setSettings(null);
          }}
        />
      )}
    </>
  );
}

interface GridProps {
  events: PlannerEvent[];
  look: Look;
  time: (min: number) => string;
  // The organization's business date (GET /me), Runtruck1's TODAY.
  today: string;
  // The one `ui-empty` line of a failed read (implementation-brief §4 rule 4).
  failure: string | null;
  onOpenDay?: ((d: Date) => void) | undefined;
  onCreate: (date: string, startMin?: number) => void;
  onSelect: (o: Occurrence, e: MouseEvent) => void;
}

function TimeGrid({
  days,
  events,
  prefs,
  look,
  time,
  today: TODAY,
  failure,
  settled,
  onOpenDay,
  onCreate,
  onSelect,
}: GridProps & { days: Date[]; prefs: Prefs; settled: boolean }) {
  const rowH = ROW_H[prefs.density];
  const visStart = prefs.dayStart * 60;
  const visEnd = prefs.dayEnd * 60;
  const hours = Array.from({ length: prefs.dayEnd - prefs.dayStart }, (_, i) => prefs.dayStart + i);
  const cols = { gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))` };
  const byDay = days.map((d) => occurrencesOn(events, iso(d)));
  const hasAllDay = byDay.some((list) => list.some((o) => o.allDay));
  const scrollRef = useRef<HTMLDivElement>(null);

  // Open on the first event of the range (or the working morning), not at midnight.
  const firstStart = Math.min(
    ...byDay
      .flat()
      .filter((o) => !o.allDay && o.end > visStart)
      .map((o) => o.start),
    8 * 60,
  );
  // Runtruck1 scrolled whenever [firstStart, visStart, rowH, days.length] changed, and it
  // always rendered a range's final layout at once. Here a range not yet loaded first renders
  // empty; scrolling then (and letting the browser's scroll anchoring shift the grid when the
  // "All day" row arrives) would leave it 38–68 px lower than Runtruck1. So the same rule runs
  // on settled renders only, compared with the last settled one (docs/api/planner.md §7.1).
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!settled) return;
    const key = `${firstStart}|${visStart}|${rowH}|${days.length}`;
    if (scrolledFor.current === key) return;
    scrolledFor.current = key;
    scrollRef.current?.scrollTo({ top: Math.max(0, ((firstStart - visStart) / 60) * rowH - 12) });
  }, [settled, firstStart, visStart, rowH, days.length]);

  const clickSlot = (date: string, e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    onCreate(date, Math.min(visStart + Math.floor((y / rowH) * 2) * 30, visEnd - 30));
  };

  return (
    <div className="cal">
      {failure !== null && <div className="ui-empty">{failure}</div>}
      <div className="cal-scroll" ref={scrollRef}>
        <div className="cal-sticky">
          <div className="cal-head" style={cols}>
            <div />
            {days.map((d) => {
              const today = iso(d) === TODAY;
              const inner = (
                <>
                  <span className="cal-head-num">{d.getDate()}</span>
                  <span className="cal-head-day">{WEEKDAYS[d.getDay()]?.slice(0, 3)}</span>
                </>
              );
              return (
                <div key={iso(d)} className="cal-head-cell">
                  {onOpenDay ? (
                    <button
                      type="button"
                      className={`cal-head-btn${today ? ' is-today' : ''}`}
                      onClick={() => {
                        onOpenDay(d);
                      }}
                    >
                      {inner}
                    </button>
                  ) : (
                    <div className={`cal-head-btn${today ? ' is-today' : ''}`}>{inner}</div>
                  )}
                </div>
              );
            })}
          </div>

          {hasAllDay && (
            <div className="cal-allday" style={cols}>
              <div className="cal-gutter-label">All day</div>
              {byDay.map((list, i) => (
                <div key={i} className="cal-allday-cell">
                  {list
                    .filter((o) => o.allDay)
                    .map((o) => (
                      <button
                        key={o.ev.id}
                        type="button"
                        className={`cal-chip t-${look.tone(o.ev)}`}
                        onClick={(e) => {
                          onSelect(o, e);
                        }}
                      >
                        {look.lines(o)[0]}
                      </button>
                    ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="cal-body" style={{ ...cols, height: hours.length * rowH, '--cal-row': `${rowH}px` } as CSSProperties}>
          <div className="cal-gutter">
            {hours.map((h) => (
              <div key={h} className="cal-hour" style={{ height: rowH }}>
                {h > prefs.dayStart && time(h * 60)}
              </div>
            ))}
          </div>
          {days.map((d, i) => {
            const date = iso(d);
            const timed = (byDay[i] ?? []).filter((o) => !o.allDay && o.end > visStart && o.start < visEnd);
            return (
              <div
                key={date}
                className={`cal-col${date === TODAY ? ' is-today' : ''}`}
                onClick={(e) => {
                  clickSlot(date, e);
                }}
              >
                {layout(timed).map(({ o, lane, lanes }) => {
                  const top = ((Math.max(o.start, visStart) - visStart) / 60) * rowH;
                  const height = Math.max(((Math.min(o.end, visEnd) - Math.max(o.start, visStart)) / 60) * rowH - 3, 20);
                  const lines = look.lines(o);
                  const fit = Math.max(1, Math.floor((height - 8) / 16));
                  return (
                    <button
                      key={o.ev.id}
                      type="button"
                      className={`cal-ev t-${look.tone(o.ev)}`}
                      style={{ top, height, left: `calc(${(lane / lanes) * 100}% + 3px)`, width: `calc(${100 / lanes}% - 6px)` }}
                      onClick={(e) => {
                        onSelect(o, e);
                      }}
                      title={lines.join(' · ')}
                    >
                      <span className="cal-ev-title">{lines[0]}</span>
                      {lines.slice(1, fit).map((t, j) => (
                        <span key={j} className="cal-ev-line">
                          {t}
                        </span>
                      ))}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({
  weeks,
  month,
  events,
  look,
  time,
  today: TODAY,
  failure,
  onOpenDay,
  onCreate,
  onSelect,
}: GridProps & { weeks: Date[][]; month: number }) {
  const MAX = 3;
  const cols = { gridTemplateColumns: `repeat(${weeks[0]?.length ?? 7}, minmax(0, 1fr))` };
  return (
    <div className="cal">
      {failure !== null && <div className="ui-empty">{failure}</div>}
      <div className="cal-month-head" style={cols}>
        {(weeks[0] ?? []).map((d) => (
          <div key={d.getDay()}>{WEEKDAYS[d.getDay()]?.slice(0, 3)}</div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={iso(week[0] ?? new Date(0))} className="cal-month-row" style={cols}>
          {week.map((d) => {
            const date = iso(d);
            const list = occurrencesOn(events, date);
            return (
              <div
                key={date}
                className={`cal-month-cell${d.getMonth() === month ? '' : ' is-other'}`}
                onClick={(e) => {
                  if (e.target === e.currentTarget) onCreate(date);
                }}
              >
                <button type="button" className={`cal-month-num${date === TODAY ? ' is-today' : ''}`} onClick={() => onOpenDay?.(d)}>
                  {d.getDate()}
                </button>
                {list.slice(0, MAX).map((o) => {
                  const tone = look.tone(o.ev);
                  return (
                    <button
                      key={o.ev.id}
                      type="button"
                      className={`cal-month-ev t-${tone}`}
                      onClick={(e) => {
                        onSelect(o, e);
                      }}
                    >
                      <span className={`cal-dot t-${tone}`} />
                      {!o.allDay && <span className="cal-month-time">{time(o.start)}</span>}
                      <span className="cal-month-title">{look.lines(o)[0]}</span>
                    </button>
                  );
                })}
                {list.length > MAX && (
                  <button type="button" className="ui-link cal-more" onClick={() => onOpenDay?.(d)}>
                    +{list.length - MAX} more
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Close a floating panel on an outside press or Escape.
function useDismiss(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return ref;
}

function EventPopover({
  sel,
  look,
  time,
  category,
  canManage,
  onClose,
  onEdit,
  onDelete,
}: {
  sel: { o: Occurrence; x: number; y: number };
  look: Look;
  time: (min: number) => string;
  category?: Category | undefined;
  // Edit and Delete need planner.manage (docs/api/planner.md §7.6).
  canManage: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const ref = useDismiss(onClose);
  const { o } = sel;
  const ev = o.ev;
  const people = ev.people?.filter((p) => p && p !== 'Unassigned') ?? [];
  const left = Math.max(12, Math.min(sel.x + 12, window.innerWidth - 352));
  const top = Math.max(12, Math.min(sel.y - 20, window.innerHeight - 360));
  const lines = look.lines(o);
  const details = [
    ['City, state', ev.place],
    ['Facility', ev.facility],
    ['Customer', ev.customer],
    ['Truck', ev.truck],
    ['Commodity', ev.commodity],
  ].filter(([, v]) => v) as [string, string][];

  return (
    <div ref={ref} className="cal-pop" style={{ left, top }} role="dialog" aria-label={lines[0]}>
      <div className="cal-pop-title">
        <span className={`cal-dot is-ring t-${look.tone(ev)}`} />
        {lines[0]}
      </div>
      <div className="cal-pop-meta">
        <span>{shortLabel(fromIso(o.date))}</span>
        <span>
          {o.allDay ? (ev.endDate ? `Until ${shortLabel(fromIso(ev.endDate))}` : 'All day') : `${time(o.start)} – ${time(o.end)}`}
        </span>
      </div>
      <div className="cal-pop-kind">
        {category?.label ?? 'Uncategorized'}
        {ev.loadId ? ` · ${ev.loadId}` : ''}
      </div>
      {details.length > 0 && (
        <dl className="cal-pop-details">
          {details.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {ev.notes && !ev.readOnly && <p className="cal-pop-notes">{ev.notes}</p>}
      {people.length > 0 && (
        <div className="cal-people">
          {people.slice(0, 3).map((p) => (
            <span key={p} className="cal-avatar" title={p}>
              {p
                .split(' ')
                .map((w) => w[0])
                .join('')
                .slice(0, 2)}
            </span>
          ))}
          <span className="cal-people-text">{people.length > 3 ? `+${people.length - 3} more` : people.join(', ')}</span>
        </div>
      )}
      <div className="cal-pop-actions">
        {ev.loadId && (
          <Link className="ui-btn ui-btn-sm" href={`/app/loads/${ev.loadId}`} scroll={false}>
            Open load {ev.loadId}
          </Link>
        )}
        {!ev.readOnly && canManage && (
          <>
            <button type="button" className="ui-btn ui-btn-sm" onClick={onEdit}>
              Edit
            </button>
            <button type="button" className="ui-btn ui-btn-sm" onClick={onDelete}>
              Delete
            </button>
          </>
        )}
      </div>
      {ev.readOnly && <div className="cal-pop-hint">From the load board — change it on the load.</div>}
    </div>
  );
}
