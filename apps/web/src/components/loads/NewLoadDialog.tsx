'use client';

import {
  carrierOptionText,
  carrierOwnFleetNote,
  DUTY_LABEL,
  formatLoadNumber,
  LOAD_DOCUMENT_TYPE_LABEL,
  LOAD_EQUIPMENT_LABEL,
  LOAD_PAYMENT_TERMS_LABEL,
  toCarrierVm,
  TRAILER_TYPE_LABEL,
  TRUCK_STATUS_LABEL,
} from '@runtruck/calculations';
import { LOAD_DOCUMENT_TYPES } from '@runtruck/validation';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useSession } from '@/context/SessionContext';
import { ApiError } from '@/lib/api/client';
import { uploadLoadDocument } from '@/lib/api/documents';
import { LOAD_WRITE_INVALIDATES, useCreateLoad } from '@/lib/api/loads';
import { invalidate } from '@/lib/api/query';
import { useNewLoadReferences } from '@/lib/api/reference';
import {
  type Draft,
  emptyStop,
  EQUIPMENT,
  type Errors,
  FREIGHT_CLASSES,
  groupIssues,
  initialDraft,
  isReefer,
  LTL_SERVICES,
  mergeErrors,
  MODES,
  PACKAGING,
  ratesStats,
  reviewStats,
  type Section,
  SECTIONS,
  type StopDraft,
  TERMS,
  toCreateLoadBody,
  validate,
} from './newLoadDraft';

// The New Load popup, ported verbatim from Runtruck1 components/NewLoadDialog.tsx
// (docs/reference/runtruck1/new-load.md). Reference lists come from the API
// (docs/api/loads.md §8.3.1), validation is the shared createLoadSchema (§8.3.3), and
// "Create load" posts the load, then uploads the chosen files (§8.3.4, documents.md §5.2).

const DOCUMENTS = LOAD_DOCUMENT_TYPES.map((type) => ({ type, name: LOAD_DOCUMENT_TYPE_LABEL[type] }));

interface FieldProps {
  label: string;
  required?: boolean;
  invalid?: boolean;
  wide?: boolean;
  group?: boolean;
  children: ReactNode;
}

// A labelled form control. `group` renders a <div> for controls that are not a
// single input (segmented choices), so the label does not swallow their clicks.
function Field({ label, required, invalid, wide, group, children }: FieldProps) {
  const cls = `ui-field${wide ? ' is-wide' : ''}${invalid ? ' is-invalid' : ''}`;
  const head = (
    <span className="ui-field-label">
      {label}
      {required && <span className="ui-req"> *</span>}
    </span>
  );
  const error = invalid && <span className="ui-field-error">Required</span>;
  return group ? (
    <div className={cls} role="group" aria-label={label}>
      {head}
      {children}
      {error}
    </div>
  ) : (
    <label className={cls}>
      {head}
      {children}
      {error}
    </label>
  );
}

function Choice<T extends string>({ options, value, onChange }: { options: T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="ui-filter" style={{ alignSelf: 'flex-start' }}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className={`ui-filter-opt${value === o ? ' is-active' : ''}`}
          onClick={() => {
            onChange(o);
          }}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

// Server answers kept for the draft they were given for (§8.3.4): 400 issues block a
// resubmit of the same draft; any other failure is listed under Review and does not.
interface ServerErrors {
  body: string;
  errors: Errors;
  blocking: boolean;
}

// The same shell as Settings, sized for a full load entry. Required fields are checked
// when Create load is pressed; sections with something missing get a count in the menu
// and the dialog jumps to the first.
export function NewLoadDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (loadNumber: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLElement>(null);
  const { me, can } = useSession();
  const queryClient = useQueryClient();
  const createLoad = useCreateLoad();
  const { customers, carriers, drivers, trucks, trailers } = useNewLoadReferences();
  const [initial] = useState<Draft>(() => initialDraft(me.user.fullName));
  const [d, setD] = useState<Draft>(initial);
  const [section, setSection] = useState<Section>('Load info');
  const [showErrors, setShowErrors] = useState(false);
  const [server, setServer] = useState<ServerErrors | null>(null);
  // The chosen File per document label (Runtruck1 kept only the name, in d.docs).
  const files = useRef(new Map<string, File>());
  const pending = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  const body = toCreateLoadBody(d);
  const bodyKey = JSON.stringify(body);
  const serverNow = server && server.body === bodyKey ? server : null;
  const blocking = serverNow?.blocking ? mergeErrors(validate(d), serverNow.errors) : validate(d);
  const errors = serverNow && !serverNow.blocking ? mergeErrors(blocking, serverNow.errors) : blocking;
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setD((prev) => ({ ...prev, [key]: value }));
  };
  const setStop = (i: number, patch: Partial<StopDraft>) => {
    setD((prev) => ({ ...prev, stops: prev.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  };
  const missing = (s: Section, msg: string) => showErrors && Boolean(errors[s]?.includes(msg));

  const go = (s: Section) => {
    setSection(s);
    bodyRef.current?.scrollTo({ top: 0 });
  };
  // Back / Next skip LTL unless the load is LTL.
  const step = (dir: 1 | -1) => {
    let i = SECTIONS.indexOf(section) + dir;
    if (SECTIONS[i] === 'LTL' && d.mode !== 'LTL') i += dir;
    const next = SECTIONS[i];
    if (next) go(next);
  };

  const requestClose = () => {
    if (!dirty || window.confirm('Discard this new load? What you entered will be lost.')) ref.current?.close();
  };

  const create = async () => {
    if (pending.current) return;
    const firstBad = SECTIONS.find((s) => blocking[s]?.length);
    if (firstBad) {
      setShowErrors(true);
      go(firstBad);
      return;
    }
    pending.current = true;
    try {
      const created = (await createLoad.mutateAsync(body)).data;
      // Upload the chosen files, one request per file, in checklist order; a failed upload
      // leaves that slot Pending and keeps the load (documents.md §5.2, C34).
      if (can('documents.upload')) {
        for (const doc of DOCUMENTS) {
          const file = files.current.get(doc.name);
          if (!d.docs[doc.name] || !file) continue;
          try {
            await uploadLoadDocument(created.id, doc.type, file);
          } catch {
            // The slot stays Pending.
          }
        }
      }
      void invalidate(queryClient, ...LOAD_WRITE_INVALIDATES);
      ref.current?.close();
      onCreated(formatLoadNumber(created.loadNumber));
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.issues.length > 0) {
        const grouped = groupIssues(err.issues);
        setServer({ body: bodyKey, errors: grouped, blocking: true });
        setShowErrors(true);
        const first = SECTIONS.find((s) => grouped[s]?.length);
        if (first) go(first);
      } else {
        const message = err instanceof ApiError ? err.message : 'Something went wrong.';
        setServer({ body: bodyKey, errors: { Review: [message] }, blocking: false });
        go('Review');
      }
    } finally {
      pending.current = false;
    }
  };

  const reefer = isReefer(d.equipment);
  const errorCount = Object.values(errors).reduce((n, list) => n + list.length, 0);

  const ownFleet = carriers.find((c) => c.isOwnFleet);
  const ownVm = ownFleet ? toCarrierVm(ownFleet) : undefined;
  const partners = carriers.filter((c) => !c.isOwnFleet).map(toCarrierVm);

  const pages: Record<Section, ReactNode> = {
    'Load info': (
      <>
        <Head title="Load information" help="Who the load is for and how it moves." />
        <div className="ui-form-grid">
          <Field label="Customer" required invalid={missing('Load info', 'Customer')}>
            <select
              className="ui-input"
              value={d.customer}
              onChange={(e) => {
                const value = e.target.value;
                const c = customers.find((x) => x.id === value);
                setD((prev) => ({ ...prev, customer: value, billTo: prev.billTo || value, terms: c ? LOAD_PAYMENT_TERMS_LABEL[c.paymentTerms] : prev.terms }));
              }}
            >
              <option value="">Select a customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Bill to">
            <select
              className="ui-input"
              value={d.billTo}
              onChange={(e) => {
                set('billTo', e.target.value);
              }}
            >
              <option value="">Same as customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tender / reference #">
            <input
              className="ui-input"
              value={d.ref}
              onChange={(e) => {
                set('ref', e.target.value);
              }}
              placeholder="e.g. PO 88-41230"
            />
          </Field>
          <Field label="Customer PO #">
            <input
              className="ui-input"
              value={d.po}
              onChange={(e) => {
                set('po', e.target.value);
              }}
            />
          </Field>
          <Field label="Mode" group>
            <Choice
              options={MODES}
              value={d.mode}
              onChange={(v) => {
                set('mode', v);
              }}
            />
          </Field>
          <Field label="Equipment" required invalid={missing('Load info', 'Equipment')}>
            <select
              className="ui-input"
              value={d.equipment}
              onChange={(e) => {
                set('equipment', e.target.value);
              }}
            >
              <option value="">Select equipment</option>
              {EQUIPMENT.map((x) => (
                <option key={x} value={x}>
                  {LOAD_EQUIPMENT_LABEL[x]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Dispatcher">
            <input
              className="ui-input"
              value={d.dispatcher}
              onChange={(e) => {
                set('dispatcher', e.target.value);
              }}
            />
          </Field>
        </div>
      </>
    ),

    Stops: (
      <>
        <Head title="Stops" help="In the order the truck runs them. Add more for multi-stop loads." />
        {showErrors && errors.Stops && <div className="ui-errors">{errors.Stops.join(' · ')}</div>}
        {d.stops.map((s, i) => (
          <div key={i} className="ui-panel">
            <div className="ui-panel-head">
              <span className={`ui-stop-kind ${s.kind === 'Pickup' ? 'pickup' : 'delivery'}`}>Stop {i + 1}</span>
              <Choice
                options={['Pickup', 'Delivery'] as StopDraft['kind'][]}
                value={s.kind}
                onChange={(v) => {
                  setStop(i, { kind: v });
                }}
              />
              <div style={{ flex: 1 }} />
              {d.stops.length > 2 && (
                <button
                  type="button"
                  className="ui-link"
                  onClick={() => {
                    set(
                      'stops',
                      d.stops.filter((_, j) => j !== i),
                    );
                  }}
                >
                  Remove
                </button>
              )}
            </div>
            <div className="ui-form-grid">
              <Field label="Facility" required wide invalid={showErrors && !s.facility.trim()}>
                <input
                  className="ui-input"
                  value={s.facility}
                  onChange={(e) => {
                    setStop(i, { facility: e.target.value });
                  }}
                  placeholder="e.g. Northgate Cold Storage"
                />
              </Field>
              <Field label="Street address" required wide invalid={showErrors && !s.address.trim()}>
                <input
                  className="ui-input"
                  value={s.address}
                  onChange={(e) => {
                    setStop(i, { address: e.target.value });
                  }}
                />
              </Field>
            </div>
            <div className="ui-form-grid is-3" style={{ marginTop: 16 }}>
              <Field label="City" required invalid={showErrors && !s.city.trim()}>
                <input
                  className="ui-input"
                  value={s.city}
                  onChange={(e) => {
                    setStop(i, { city: e.target.value });
                  }}
                />
              </Field>
              <Field label="State" required invalid={showErrors && !s.state.trim()}>
                <input
                  className="ui-input"
                  value={s.state}
                  maxLength={2}
                  onChange={(e) => {
                    setStop(i, { state: e.target.value });
                  }}
                  placeholder="CA"
                />
              </Field>
              <Field label="ZIP">
                <input
                  className="ui-input"
                  value={s.zip}
                  inputMode="numeric"
                  onChange={(e) => {
                    setStop(i, { zip: e.target.value });
                  }}
                />
              </Field>
              <Field label="Date" required invalid={showErrors && !s.date}>
                <input
                  className="ui-input"
                  type="date"
                  value={s.date}
                  onChange={(e) => {
                    setStop(i, { date: e.target.value });
                  }}
                />
              </Field>
              <Field label="Window opens">
                <input
                  className="ui-input"
                  type="time"
                  value={s.from}
                  onChange={(e) => {
                    setStop(i, { from: e.target.value });
                  }}
                />
              </Field>
              <Field label="Window closes">
                <input
                  className="ui-input"
                  type="time"
                  value={s.to}
                  onChange={(e) => {
                    setStop(i, { to: e.target.value });
                  }}
                />
              </Field>
              <Field label={`${s.kind} #`}>
                <input
                  className="ui-input"
                  value={s.number}
                  onChange={(e) => {
                    setStop(i, { number: e.target.value });
                  }}
                />
              </Field>
              <Field label="Site contact" wide>
                <input
                  className="ui-input"
                  value={s.contact}
                  onChange={(e) => {
                    setStop(i, { contact: e.target.value });
                  }}
                  placeholder="Name and phone"
                />
              </Field>
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className="ui-btn"
            onClick={() => {
              set('stops', [...d.stops.slice(0, -1), emptyStop('Pickup'), ...d.stops.slice(-1)]);
            }}
          >
            + Add pickup
          </button>
          <button
            type="button"
            className="ui-btn"
            onClick={() => {
              set('stops', [...d.stops, emptyStop('Delivery')]);
            }}
          >
            + Add delivery
          </button>
        </div>
      </>
    ),

    Freight: (
      <>
        <Head title="Freight" help="What is on the trailer." />
        <div className="ui-form-grid">
          <Field label="Commodity" required wide invalid={missing('Freight', 'Commodity')}>
            <input
              className="ui-input"
              value={d.commodity}
              onChange={(e) => {
                set('commodity', e.target.value);
              }}
              placeholder="e.g. Frozen produce"
            />
          </Field>
          <Field label="Weight (lb)" required invalid={missing('Freight', 'Weight')}>
            <input
              className="ui-input"
              type="number"
              min={0}
              value={d.weight}
              onChange={(e) => {
                set('weight', e.target.value);
              }}
            />
          </Field>
          <Field label="Declared value ($)">
            <input
              className="ui-input"
              type="number"
              min={0}
              value={d.value}
              onChange={(e) => {
                set('value', e.target.value);
              }}
            />
          </Field>
          <Field label="Pieces">
            <input
              className="ui-input"
              type="number"
              min={0}
              value={d.pieces}
              onChange={(e) => {
                set('pieces', e.target.value);
              }}
            />
          </Field>
          <Field label="Packaging">
            <select
              className="ui-input"
              value={d.packaging}
              onChange={(e) => {
                set('packaging', e.target.value);
              }}
            >
              {PACKAGING.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          {reefer && (
            <Field label="Temperature (°F)">
              <input
                className="ui-input"
                type="number"
                value={d.temp}
                onChange={(e) => {
                  set('temp', e.target.value);
                }}
                placeholder="e.g. -10"
              />
            </Field>
          )}
          <div className="ui-field is-wide">
            <label className="ui-check">
              <input
                type="checkbox"
                checked={d.hazmat}
                onChange={(e) => {
                  set('hazmat', e.target.checked);
                }}
              />
              Hazardous materials
            </label>
          </div>
          {d.hazmat && (
            <Field label="UN number" required invalid={missing('Freight', 'UN number for hazmat')}>
              <input
                className="ui-input"
                value={d.unNumber}
                onChange={(e) => {
                  set('unNumber', e.target.value);
                }}
                placeholder="e.g. UN1203"
              />
            </Field>
          )}
        </div>
      </>
    ),

    LTL:
      d.mode === 'LTL' ? (
        <>
          <Head title="LTL details" help="Needed to rate and class a less-than-truckload shipment." />
          <div className="ui-form-grid">
            <Field label="Freight class" required invalid={missing('LTL', 'Freight class')}>
              <select
                className="ui-input"
                value={d.freightClass}
                onChange={(e) => {
                  set('freightClass', e.target.value);
                }}
              >
                <option value="">Select a class</option>
                {FREIGHT_CLASSES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="NMFC #">
              <input
                className="ui-input"
                value={d.nmfc}
                onChange={(e) => {
                  set('nmfc', e.target.value);
                }}
              />
            </Field>
            <Field label="Handling units" required invalid={missing('LTL', 'Handling units')}>
              <input
                className="ui-input"
                type="number"
                min={0}
                value={d.handlingUnits}
                onChange={(e) => {
                  set('handlingUnits', e.target.value);
                }}
              />
            </Field>
            <div className="ui-field" style={{ justifyContent: 'flex-end' }}>
              <label className="ui-check">
                <input
                  type="checkbox"
                  checked={d.stackable}
                  onChange={(e) => {
                    set('stackable', e.target.checked);
                  }}
                />
                Stackable
              </label>
            </div>
          </div>
          <div className="ui-form-grid is-3">
            <Field label="Length (in)">
              <input
                className="ui-input"
                type="number"
                min={0}
                value={d.length}
                onChange={(e) => {
                  set('length', e.target.value);
                }}
              />
            </Field>
            <Field label="Width (in)">
              <input
                className="ui-input"
                type="number"
                min={0}
                value={d.width}
                onChange={(e) => {
                  set('width', e.target.value);
                }}
              />
            </Field>
            <Field label="Height (in)">
              <input
                className="ui-input"
                type="number"
                min={0}
                value={d.height}
                onChange={(e) => {
                  set('height', e.target.value);
                }}
              />
            </Field>
          </div>
          <Field label="Services" group>
            <div className="ui-checks">
              {LTL_SERVICES.map((x) => (
                <label key={x} className="ui-check">
                  <input
                    type="checkbox"
                    checked={d.services.includes(x)}
                    onChange={(e) => {
                      set('services', e.target.checked ? [...d.services, x] : d.services.filter((y) => y !== x));
                    }}
                  />
                  {x}
                </label>
              ))}
            </div>
          </Field>
        </>
      ) : (
        <>
          <Head title="LTL details" help="Only needed for less-than-truckload shipments." />
          <div className="ui-note">
            This load is {d.mode === 'FTL' ? 'a full truckload' : 'a partial'}, so there is nothing to fill in here.{' '}
            <button
              type="button"
              className="ui-link"
              onClick={() => {
                set('mode', 'LTL');
              }}
            >
              Make it an LTL load
            </button>
          </div>
        </>
      ),

    Carrier: (
      <>
        <Head title="Carrier" help={`Haul it with the ${me.organization.shortName} fleet, or broker it to a partner carrier.`} />
        <Field label="Hauled by" group>
          <Choice
            options={['Own fleet', 'Partner carrier']}
            value={d.brokered ? 'Partner carrier' : 'Own fleet'}
            onChange={(v) => {
              setD((prev) => ({ ...prev, brokered: v === 'Partner carrier', driver: '', truck: '', trailer: '' }));
            }}
          />
        </Field>
        {d.brokered ? (
          <div className="ui-form-grid">
            <Field label="Carrier" required invalid={missing('Carrier', 'Carrier')}>
              <select
                className="ui-input"
                value={d.carrier}
                onChange={(e) => {
                  set('carrier', e.target.value);
                }}
              >
                <option value="">Select a carrier</option>
                {partners.map((c) => (
                  <option key={c.ref.id} value={c.ref.id}>
                    {carrierOptionText(c)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Carrier rate ($)" required invalid={missing('Carrier', 'Carrier rate')}>
              <input
                className="ui-input"
                type="number"
                min={0}
                value={d.carrierRate}
                onChange={(e) => {
                  set('carrierRate', e.target.value);
                }}
              />
            </Field>
            <Field label="Carrier dispatcher">
              <input
                className="ui-input"
                value={d.carrierContact}
                onChange={(e) => {
                  set('carrierContact', e.target.value);
                }}
              />
            </Field>
            <Field label="Carrier phone">
              <input
                className="ui-input"
                type="tel"
                value={d.carrierPhone}
                onChange={(e) => {
                  set('carrierPhone', e.target.value);
                }}
              />
            </Field>
          </div>
        ) : (
          <div className="ui-note">{carrierOwnFleetNote(ownVm)}</div>
        )}
      </>
    ),

    'Driver & equipment': (
      <>
        <Head
          title="Driver & equipment"
          help={d.brokered ? 'The partner carrier’s driver and units, if you have them yet.' : 'Leave the driver empty to put the load on the board as Needs driver.'}
        />
        {d.brokered ? (
          <div className="ui-form-grid is-3">
            <Field label="Driver name">
              <input
                className="ui-input"
                value={d.driver}
                onChange={(e) => {
                  set('driver', e.target.value);
                }}
              />
            </Field>
            <Field label="Truck #">
              <input
                className="ui-input"
                value={d.truck}
                onChange={(e) => {
                  set('truck', e.target.value);
                }}
              />
            </Field>
            <Field label="Trailer #">
              <input
                className="ui-input"
                value={d.trailer}
                onChange={(e) => {
                  set('trailer', e.target.value);
                }}
              />
            </Field>
          </div>
        ) : (
          <div className="ui-form-grid is-3">
            <Field label="Driver">
              <select
                className="ui-input"
                value={d.driver}
                onChange={(e) => {
                  const value = e.target.value;
                  const drv = drivers.find((x) => x.id === value);
                  setD((prev) => ({ ...prev, driver: value, truck: prev.truck || drv?.truck?.id || '' }));
                }}
              >
                <option value="">Unassigned</option>
                {drivers.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.fullName} · {DUTY_LABEL[x.dutyStatus]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Truck">
              <select
                className="ui-input"
                value={d.truck}
                onChange={(e) => {
                  set('truck', e.target.value);
                }}
              >
                <option value="">None</option>
                {trucks.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.unitNumber} · {TRUCK_STATUS_LABEL[x.status]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Trailer">
              <select
                className="ui-input"
                value={d.trailer}
                onChange={(e) => {
                  set('trailer', e.target.value);
                }}
              >
                <option value="">None</option>
                {trailers.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.unitNumber} · {`${TRAILER_TYPE_LABEL[x.trailerType]} · ${x.lengthFt} ft`}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
      </>
    ),

    Rates: (
      <>
        <Head title="Rates" help="What the customer pays and what the load costs." />
        <div className="ui-form-grid">
          <Field label="Line haul ($)" required invalid={missing('Rates', 'Line haul rate')}>
            <input
              className="ui-input"
              type="number"
              min={0}
              value={d.lineHaul}
              onChange={(e) => {
                set('lineHaul', e.target.value);
              }}
            />
          </Field>
          <Field label="Fuel surcharge ($)">
            <input
              className="ui-input"
              type="number"
              min={0}
              value={d.fuel}
              onChange={(e) => {
                set('fuel', e.target.value);
              }}
            />
          </Field>
          <Field label="Accessorial charges ($)">
            <input
              className="ui-input"
              type="number"
              min={0}
              value={d.accessorials}
              onChange={(e) => {
                set('accessorials', e.target.value);
              }}
            />
          </Field>
          <Field label="Loaded miles">
            <input
              className="ui-input"
              type="number"
              min={0}
              value={d.miles}
              onChange={(e) => {
                set('miles', e.target.value);
              }}
            />
          </Field>
          {!d.brokered && (
            <Field label="Driver pay ($)">
              <input
                className="ui-input"
                type="number"
                min={0}
                value={d.driverPay}
                onChange={(e) => {
                  set('driverPay', e.target.value);
                }}
              />
            </Field>
          )}
          <Field label="Payment terms">
            <select
              className="ui-input"
              value={d.terms}
              onChange={(e) => {
                set('terms', e.target.value);
              }}
            >
              {TERMS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="ui-summary">
          {ratesStats(d).map((stat) => (
            <Stat key={stat.label} label={stat.label} value={stat.value} />
          ))}
        </div>
      </>
    ),

    Documents: (
      <>
        <Head title="Documents" help="Attach what you have now; the rest can be added from the load later." />
        <div className="ui-panel" style={{ padding: '4px 18px' }}>
          {DOCUMENTS.map(({ name }) => {
            const file = d.docs[name];
            return (
              <div key={name} className="ui-file-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{name}</div>
                  <div className="ui-setting-help" style={{ overflowWrap: 'anywhere' }}>
                    {file || 'Not attached'}
                  </div>
                </div>
                {file && (
                  <button
                    type="button"
                    className="ui-link"
                    onClick={() => {
                      files.current.delete(name);
                      set('docs', { ...d.docs, [name]: '' });
                    }}
                  >
                    Remove
                  </button>
                )}
                {can('documents.upload') && (
                  <label className="ui-btn ui-btn-sm">
                    {file ? 'Replace' : 'Attach'}
                    <input
                      className="ui-file-input"
                      type="file"
                      accept=".pdf,image/*"
                      onChange={(e) => {
                        const chosen = e.target.files?.[0];
                        if (chosen) files.current.set(name, chosen);
                        else files.current.delete(name);
                        set('docs', { ...d.docs, [name]: chosen?.name ?? '' });
                      }}
                    />
                  </label>
                )}
              </div>
            );
          })}
        </div>
      </>
    ),

    Notes: (
      <>
        <Head title="Notes" help="Instructions go to the driver with the load; internal notes stay in the office." />
        <div className="ui-form-grid">
          <Field label="Driver instructions" wide>
            <textarea
              className="ui-input"
              value={d.instructions}
              onChange={(e) => {
                set('instructions', e.target.value);
              }}
              placeholder="Check in at gate 3, 2-hour free time, no touch freight…"
            />
          </Field>
          <Field label="Internal notes" wide>
            <textarea
              className="ui-input"
              value={d.internal}
              onChange={(e) => {
                set('internal', e.target.value);
              }}
            />
          </Field>
        </div>
      </>
    ),

    Review: (
      <>
        <Head title="Review" help="Check the load before it goes on the board." />
        {errorCount > 0 ? (
          <div className="ui-errors">
            <strong>
              {errorCount} {errorCount === 1 ? 'thing' : 'things'} left to fill in
            </strong>
            {SECTIONS.filter((s) => errors[s]?.length).map((s) => (
              <div key={s} style={{ marginTop: 6 }}>
                <button
                  type="button"
                  className="ui-link"
                  onClick={() => {
                    setShowErrors(true);
                    go(s);
                  }}
                >
                  {s}
                </button>
                {' — '}
                {errors[s]?.join(', ')}
              </div>
            ))}
          </div>
        ) : (
          <div className="ui-note">Everything required is filled in. It goes on the board as {d.brokered || d.driver ? 'Dispatched' : 'Needs driver'}.</div>
        )}
        <div className="ui-summary">
          {reviewStats(d, { customers, drivers, partnerName: (id) => partners.find((c) => c.ref.id === id)?.name, ownFleetName: ownVm?.name }).map((stat) => (
            <Stat key={stat.label} label={stat.label} value={stat.value} />
          ))}
        </div>
      </>
    ),
  };

  return (
    <dialog
      ref={ref}
      className="ui-dialog is-large"
      aria-label="New load"
      onClose={onClose}
      onCancel={(e) => {
        // Escape: ask before throwing away a half-entered load.
        e.preventDefault();
        requestClose();
      }}
    >
      <aside className="ui-dialog-nav">
        <div className="ui-dialog-title">New load</div>
        {SECTIONS.map((s) => {
          const n = showErrors ? (errors[s]?.length ?? 0) : 0;
          return (
            <button
              key={s}
              type="button"
              className={`ui-dialog-nav-item${section === s ? ' is-active' : ''}`}
              onClick={() => {
                go(s);
              }}
            >
              <span>{s}</span>
              {n > 0 && (
                <span className="ui-badge" aria-label={`${n} missing`}>
                  {n}
                </span>
              )}
              {n === 0 && s === 'LTL' && d.mode !== 'LTL' && <span className="ui-nav-note">N/A</span>}
            </button>
          );
        })}
      </aside>
      <div className="ui-dialog-main">
        <section className="ui-dialog-body" ref={bodyRef}>
          <button type="button" className="ui-dialog-close" onClick={requestClose} aria-label="Close">
            ×
          </button>
          {pages[section]}
        </section>
        <footer className="ui-dialog-foot">
          <button type="button" className="ui-btn" onClick={requestClose}>
            Cancel
          </button>
          <div style={{ flex: 1 }} />
          {section !== SECTIONS[0] && (
            <button
              type="button"
              className="ui-btn"
              onClick={() => {
                step(-1);
              }}
            >
              Back
            </button>
          )}
          {section !== 'Review' && (
            <button
              type="button"
              className="ui-btn"
              onClick={() => {
                step(1);
              }}
            >
              Next
            </button>
          )}
          <button type="button" className="ui-btn ui-btn-primary" onClick={create}>
            Create load
          </button>
        </footer>
      </div>
    </dialog>
  );
}

function Head({ title, help }: { title: string; help: string }) {
  return (
    <div>
      <h2 className="ui-h2" style={{ margin: 0 }}>
        {title}
      </h2>
      <p className="ui-p" style={{ marginTop: 4 }}>
        {help}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="ui-label">{label}</div>
      <div className="ui-kv-value" style={{ fontSize: 15 }}>
        {value}
      </div>
    </div>
  );
}

