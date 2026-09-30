'use client';

import { formatLoadNumber } from '@runtruck/calculations';
import type { PlannerRelatedLoadDto } from '@runtruck/types';
import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/context/SessionContext';
import { usePlannerRelatedLoads } from '@/lib/api/planner';
import { toMinutes } from '@/lib/dates';
import type { Category, PlannerEvent } from './planner-data';

// Ported verbatim from Runtruck1 components/EventDialog.tsx (docs/reference/runtruck1/planner.md
// §6). Only the data changed: the "Related load" options come from GET /planner/related-loads
// (docs/api/planner.md §3.10, P2), and Save / Delete wait for the API and close only when it
// succeeds (a failed write shows an alert and changes nothing, P7).

interface Props {
  event: PlannerEvent;
  categories: Category[];
  isNew: boolean;
  // Resolve true when the API accepted the write; the dialog then closes.
  onSave: (e: PlannerEvent, relatedLoads: readonly PlannerRelatedLoadDto[]) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onClose: () => void;
}

// Add or edit a planner event. A native <dialog>, like Settings and New Load.
export function EventDialog({ event, categories, isNew, onSave, onDelete, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const { can } = useSession();
  // Without loads.view the select offers only "None"; an existing link is kept on save (§7.6).
  const related = usePlannerRelatedLoads(can('planner.manage', 'loads.view'));
  const loads = related.data?.data ?? [];
  const [e, setE] = useState<PlannerEvent>(event);
  const [allDay, setAllDay] = useState(!event.start);
  const [tried, setTried] = useState(false);
  // Repeated clicks are ignored while a write is pending.
  const busy = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  const set = <K extends keyof PlannerEvent>(key: K, value: PlannerEvent[K]) => {
    setE((prev) => ({ ...prev, [key]: value }));
  };
  const start = e.start ?? '09:00';
  const end = e.end ?? '10:00';
  const badTitle = !e.title.trim();
  const badDate = !e.date;
  const badEnd = allDay ? Boolean(e.endDate && e.endDate < e.date) : toMinutes(end) <= toMinutes(start);

  const write = async (run: () => Promise<boolean>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (await run()) ref.current?.close();
    } finally {
      busy.current = false;
    }
  };

  const save = () => {
    if (badTitle || badDate || badEnd) {
      setTried(true);
      return;
    }
    void write(() =>
      onSave(
        {
          ...e,
          title: e.title.trim(),
          place: e.place?.trim() || undefined,
          start: allDay ? undefined : start,
          end: allDay ? undefined : end,
          endDate: allDay && e.endDate && e.endDate > e.date ? e.endDate : undefined,
          people: e.people?.map((p) => p.trim()).filter(Boolean),
        },
        loads,
      ),
    );
  };

  return (
    <dialog ref={ref} className="ui-dialog is-form" aria-label={isNew ? 'Add event' : 'Edit event'} onClose={onClose}>
      <div className="ui-dialog-main">
        <section className="ui-dialog-body">
          <button type="button" className="ui-dialog-close" onClick={() => ref.current?.close()} aria-label="Close">
            ×
          </button>
          <h2 className="ui-h2" style={{ margin: 0 }}>
            {isNew ? 'Add event' : 'Edit event'}
          </h2>
          <div className="ui-form-grid">
            <label className={`ui-field is-wide${tried && badTitle ? ' is-invalid' : ''}`}>
              <span className="ui-field-label">
                Title <span className="ui-req">*</span>
              </span>
              <input
                className="ui-input"
                value={e.title}
                onChange={(x) => {
                  set('title', x.target.value);
                }}
                autoFocus
              />
            </label>
            <label className="ui-field">
              <span className="ui-field-label">Color code</span>
              <select
                className="ui-input"
                value={e.category}
                onChange={(x) => {
                  set('category', x.target.value);
                }}
              >
                {categories
                  .filter((c) => !c.locked || c.key === e.category)
                  .map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
              </select>
            </label>
            <label className={`ui-field${tried && badDate ? ' is-invalid' : ''}`}>
              <span className="ui-field-label">
                Date <span className="ui-req">*</span>
              </span>
              <input
                className="ui-input"
                type="date"
                value={e.date}
                onChange={(x) => {
                  set('date', x.target.value);
                }}
              />
            </label>
            <div className="ui-field is-wide">
              <label className="ui-check">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(x) => {
                    setAllDay(x.target.checked);
                  }}
                />
                All day
              </label>
            </div>
            {allDay ? (
              <label className={`ui-field${tried && badEnd ? ' is-invalid' : ''}`}>
                <span className="ui-field-label">Until (optional)</span>
                <input
                  className="ui-input"
                  type="date"
                  value={e.endDate ?? ''}
                  min={e.date}
                  onChange={(x) => {
                    set('endDate', x.target.value || undefined);
                  }}
                />
                {tried && badEnd && <span className="ui-field-error">Must be on or after the start date</span>}
              </label>
            ) : (
              <>
                <label className="ui-field">
                  <span className="ui-field-label">Starts</span>
                  <input
                    className="ui-input"
                    type="time"
                    step={900}
                    value={start}
                    onChange={(x) => {
                      set('start', x.target.value);
                    }}
                  />
                </label>
                <label className={`ui-field${tried && badEnd ? ' is-invalid' : ''}`}>
                  <span className="ui-field-label">Ends</span>
                  <input
                    className="ui-input"
                    type="time"
                    step={900}
                    value={end}
                    onChange={(x) => {
                      set('end', x.target.value);
                    }}
                  />
                  {tried && badEnd && <span className="ui-field-error">Must be after the start</span>}
                </label>
              </>
            )}
            <label className="ui-field">
              <span className="ui-field-label">City, state</span>
              <input
                className="ui-input"
                value={e.place ?? ''}
                onChange={(x) => {
                  set('place', x.target.value);
                }}
                placeholder="e.g. Modesto, CA"
              />
            </label>
            <label className="ui-field">
              <span className="ui-field-label">Related load</span>
              <select
                className="ui-input"
                value={e.loadId ?? ''}
                onChange={(x) => {
                  set('loadId', x.target.value || undefined);
                }}
              >
                <option value="">None</option>
                {loads.map((l) => (
                  <option key={l.id} value={formatLoadNumber(l.loadNumber)}>
                    {formatLoadNumber(l.loadNumber)} · {l.route}
                  </option>
                ))}
              </select>
            </label>
            <label className="ui-field is-wide">
              <span className="ui-field-label">People (comma-separated)</span>
              <input
                className="ui-input"
                value={(e.people ?? []).join(', ')}
                onChange={(x) => {
                  set(
                    'people',
                    x.target.value.split(',').map((p) => p.trimStart()),
                  );
                }}
              />
            </label>
            <label className="ui-field is-wide">
              <span className="ui-field-label">Notes</span>
              <textarea
                className="ui-input"
                value={e.notes ?? ''}
                onChange={(x) => {
                  set('notes', x.target.value || undefined);
                }}
              />
            </label>
          </div>
        </section>
        <footer className="ui-dialog-foot">
          {!isNew && (
            <button
              type="button"
              className="ui-btn"
              onClick={() => {
                void write(onDelete);
              }}
            >
              Delete
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button type="button" className="ui-btn" onClick={() => ref.current?.close()}>
            Cancel
          </button>
          <button type="button" className="ui-btn ui-btn-primary" onClick={save}>
            {isNew ? 'Add event' : 'Save'}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
