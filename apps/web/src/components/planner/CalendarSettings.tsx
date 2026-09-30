'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { formatTime } from '@/lib/dates';
import { CARD_FIELDS, type CardField, type Category, type ColorBy, type Density, type Prefs, TONES } from './planner-data';

// Ported verbatim from Runtruck1 components/CalendarSettings.tsx (docs/reference/runtruck1/
// planner.md §7). Color-code edits are organization data now (docs/api/planner.md §7.5): the
// page saves them through the API; without planner.configure the code controls are read-only
// or hidden (§7.6). Reset stays visible for everyone and is decided by the API (D8).

export type SettingsPage = 'Layout' | 'Color codes' | 'Event cards';
const PAGES: SettingsPage[] = ['Layout', 'Color codes', 'Event cards'];

const COLOR_BY: [ColorBy, string][] = [
  ['type', 'Stop type'],
  ['driver', 'Driver'],
  ['customer', 'Customer'],
  ['truck', 'Truck'],
];
const VALUE_NOUN: Record<ColorBy, string> = { type: '', driver: 'Driver', customer: 'Customer', truck: 'Truck' };

interface Props {
  page: SettingsPage;
  prefs: Prefs;
  pref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  categories: Category[];
  onCategory: (key: string, patch: Partial<Pick<Category, 'label' | 'tone'>>) => void;
  // A code name input lost focus (the page flushes its debounced rename, decision P8).
  onCategoryBlur: (key: string) => void;
  onCategoryFocus: (key: string) => void;
  onAddCategory: () => void;
  onDeleteCategory: (key: string) => void;
  // planner.configure: rename, recolour, add and delete color codes.
  canConfigure: boolean;
  values: string[];
  valueTone: (v: string) => string;
  sample: { lines: string[]; tone: string };
  onReset: () => void;
  onClose: () => void;
}

function Choice<T extends string | number | boolean>({
  options,
  value,
  onChange,
}: {
  options: [T, string][];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="ui-filter">
      {options.map(([v, label]) => (
        <button
          key={label}
          type="button"
          className={`ui-filter-opt${value === v ? ' is-active' : ''}`}
          onClick={() => {
            onChange(v);
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Palette({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (tone: string) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="cal-palette" role="radiogroup" aria-label={`Color for ${label}`}>
      {TONES.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={value === t}
          aria-label={t}
          title={t}
          className={`cal-swatch t-${t}${value === t ? ' is-on' : ''}`}
          disabled={disabled}
          onClick={() => {
            onChange(t);
          }}
        />
      ))}
    </div>
  );
}

function Row({ label, help, stacked, children }: { label: string; help?: string; stacked?: boolean; children: ReactNode }) {
  return (
    <div className={`ui-setting${stacked ? ' is-stacked' : ''}`}>
      <div>
        <div className="ui-setting-name">{label}</div>
        {help && <div className="ui-setting-help">{help}</div>}
      </div>
      {children}
    </div>
  );
}

// The planner's Customize popup: a native <dialog> in the Settings layout,
// with Layout, Color codes and Event cards pages. Every change applies live.
export function CalendarSettings(p: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [page, setPage] = useState<SettingsPage>(p.page);
  const { prefs, pref } = p;

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  const hours = Array.from({ length: 25 }, (_, h) => h);
  const byValue = prefs.colorBy !== 'type';
  const setLine = (i: number, f: CardField) => {
    pref(
      'cardLines',
      prefs.cardLines.map((x, j) => (j === i ? f : x)),
    );
  };

  const pages: Record<SettingsPage, ReactNode> = {
    Layout: (
      <>
        <h2 className="ui-h2" style={{ margin: 0 }}>
          Layout
        </h2>
        <div>
          <Row label="Week starts on">
            <Choice<number>
              options={[
                [0, 'Sun'],
                [1, 'Mon'],
              ]}
              value={prefs.weekStart}
              onChange={(v) => {
                pref('weekStart', v);
              }}
            />
          </Row>
          <Row label="Weekends">
            <Choice<boolean>
              options={[
                [true, 'Show'],
                [false, 'Hide'],
              ]}
              value={prefs.showWeekends}
              onChange={(v) => {
                pref('showWeekends', v);
              }}
            />
          </Row>
          <Row label="Time format">
            <Choice<boolean>
              options={[
                [false, '12h'],
                [true, '24h'],
              ]}
              value={prefs.hour24}
              onChange={(v) => {
                pref('hour24', v);
              }}
            />
          </Row>
          <Row label="Row height" help="How tall an hour is in Day and Week views.">
            <Choice<Density>
              options={[
                ['Compact', 'S'],
                ['Comfortable', 'M'],
                ['Spacious', 'L'],
              ]}
              value={prefs.density}
              onChange={(v) => {
                pref('density', v);
              }}
            />
          </Row>
          <Row label="Day starts">
            <select
              className="ui-input cal-menu-select"
              value={prefs.dayStart}
              onChange={(e) => {
                pref('dayStart', Math.min(Number(e.target.value), prefs.dayEnd - 1));
              }}
            >
              {hours.slice(0, 24).map((h) => (
                <option key={h} value={h}>
                  {formatTime(h * 60, prefs.hour24)}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Day ends">
            <select
              className="ui-input cal-menu-select"
              value={prefs.dayEnd}
              onChange={(e) => {
                pref('dayEnd', Math.max(Number(e.target.value), prefs.dayStart + 1));
              }}
            >
              {hours.slice(1).map((h) => (
                <option key={h} value={h}>
                  {h === 24 ? 'Midnight' : formatTime(h * 60, prefs.hour24)}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Reset calendar" help="Layout, color codes and card lines back to the defaults, and the original events restored.">
            <button
              type="button"
              className="ui-btn ui-btn-sm"
              onClick={() => {
                if (
                  window.confirm(
                    'Reset the calendar? Color codes, layout and card settings go back to the defaults, and events you added or edited are removed.',
                  )
                )
                  p.onReset();
              }}
            >
              Reset
            </button>
          </Row>
        </div>
      </>
    ),

    'Color codes': (
      <>
        <div>
          <h2 className="ui-h2" style={{ margin: 0 }}>
            Color codes
          </h2>
          <p className="ui-p" style={{ marginTop: 4 }}>
            Decide what each color stands for. Rename, recolor, add or delete them.
          </p>
        </div>
        <Row
          stacked
          label="Color load stops by"
          help="Stop type uses the Loaded and Empty codes below; the others give each driver, customer or truck its own color."
        >
          <Choice<ColorBy>
            options={COLOR_BY}
            value={prefs.colorBy}
            onChange={(v) => {
              pref('colorBy', v);
            }}
          />
        </Row>
        <div className="cal-codes">
          {p.categories.map((c) => (
            <div key={c.key} className={`cal-code${c.locked && byValue ? ' is-muted' : ''}`}>
              <span className={`cal-dot t-${c.tone}`} />
              <input
                className="ui-input cal-code-name"
                value={c.label}
                aria-label="Color code name"
                readOnly={!p.canConfigure}
                onFocus={() => {
                  p.onCategoryFocus(c.key);
                }}
                onChange={(e) => {
                  p.onCategory(c.key, { label: e.target.value });
                }}
                onBlur={(e) => {
                  if (!e.target.value.trim()) p.onCategory(c.key, { label: 'Untitled' });
                  p.onCategoryBlur(c.key);
                }}
              />
              {c.locked ? (
                <span className="cal-code-note">
                  {byValue ? 'Not used while coloring by ' + VALUE_NOUN[prefs.colorBy].toLowerCase() : 'From the load board'}
                </span>
              ) : p.canConfigure ? (
                <button
                  type="button"
                  className="ui-link"
                  onClick={() => {
                    p.onDeleteCategory(c.key);
                  }}
                >
                  Delete
                </button>
              ) : (
                <span />
              )}
              <Palette
                value={c.tone}
                label={c.label}
                disabled={!p.canConfigure}
                onChange={(tone) => {
                  p.onCategory(c.key, { tone: tone as Category['tone'] });
                }}
              />
            </div>
          ))}
        </div>
        {p.canConfigure && (
          <button type="button" className="ui-btn" style={{ alignSelf: 'flex-start' }} onClick={p.onAddCategory}>
            + Add color code
          </button>
        )}

        {byValue && (
          <>
            <h3 className="cal-subhead">{VALUE_NOUN[prefs.colorBy]} colors</h3>
            <div className="cal-codes">
              {p.values.map((v) => (
                <div key={v} className="cal-code">
                  <span className={`cal-dot t-${p.valueTone(v)}`} />
                  <span className="cal-code-name is-text">{v}</span>
                  <span />
                  <Palette
                    value={p.valueTone(v)}
                    label={v}
                    onChange={(tone) => {
                      pref('valueTones', { ...prefs.valueTones, [`${prefs.colorBy}:${v}`]: tone });
                    }}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </>
    ),

    'Event cards': (
      <>
        <div>
          <h2 className="ui-h2" style={{ margin: 0 }}>
            Event cards
          </h2>
          <p className="ui-p" style={{ marginTop: 4 }}>
            Choose what each card shows. By default a load stop leads with the city and state where the truck loads or goes empty.
          </p>
        </div>
        <div className="cal-cards-setup">
          <div className="ui-form-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
            {prefs.cardLines.map((f, i) => (
              <label key={i} className="ui-field">
                <span className="ui-field-label">{i === 0 ? 'First line (bold)' : `Line ${i + 1}`}</span>
                <select
                  className="ui-input"
                  value={f}
                  onChange={(e) => {
                    setLine(i, e.target.value as CardField);
                  }}
                >
                  {CARD_FIELDS.filter(([k]) => i > 0 || k !== 'none').map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div>
            <div className="ui-label" style={{ marginBottom: 8 }}>
              Preview
            </div>
            <div className={`cal-ev cal-preview t-${p.sample.tone}`}>
              <span className="cal-ev-title">{p.sample.lines[0]}</span>
              {p.sample.lines.slice(1).map((t, i) => (
                <span key={i} className="cal-ev-line">
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="ui-note">
          Short cards show as many lines as fit. Month view shows the first line. When the first line is empty (an office event with no
          city, say) the card falls back to the event title.
        </div>
      </>
    ),
  };

  return (
    <dialog ref={ref} className="ui-dialog" aria-label="Customize calendar" onClose={p.onClose}>
      <aside className="ui-dialog-nav">
        <div className="ui-dialog-title">Customize</div>
        {PAGES.map((pg) => (
          <button
            key={pg}
            type="button"
            className={`ui-dialog-nav-item${page === pg ? ' is-active' : ''}`}
            onClick={() => {
              setPage(pg);
            }}
          >
            {pg}
          </button>
        ))}
      </aside>
      <section className="ui-dialog-body">
        <button type="button" className="ui-dialog-close" onClick={() => ref.current?.close()} aria-label="Close">
          ×
        </button>
        {pages[page]}
      </section>
    </dialog>
  );
}
