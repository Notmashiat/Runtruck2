import Link from 'next/link';
import { Blueprint } from '@runtruck/ui';

const SPECS = [
  { no: '01', prop: 'Spreadsheets retired per fleet', val: '15+', rem: 'Dispatch, fuel, payroll, IFTA, maintenance' },
  { no: '02', prop: 'Time to invoice a delivered load', val: '4 min', rem: 'From POD upload to invoice sent' },
  { no: '03', prop: 'Integrations and open API', val: '100+', rem: 'ELD, factoring, fuel cards, accounting, EDI' },
  { no: '04', prop: 'Setup with your own data', val: '5 days', rem: 'Migration and training included' },
];

const FEATURES = [
  { title: 'Dispatch & planning', body: 'One board for every load: assign a driver and trailer, see hours of service before you commit, and watch stops close in real time instead of calling for updates.' },
  { title: 'Fleet & safety', body: 'Trucks, trailers, odometers and service intervals in one register. CDLs, medical cards and annual reviews raise themselves before they expire.' },
  { title: 'Driver app', body: 'Drivers accept loads, photograph the bill of lading, log fuel and check settlements from their phone. The document lands on the load, not in a text thread.' },
  { title: 'Invoicing & settlements', body: 'Invoice a load the moment the POD arrives, run driver pay by mile, percentage or flat rate, and see aging by customer without exporting anything.' },
  { title: 'Reporting you can act on', body: 'Revenue per mile, deadhead, cost per truck and margin by customer — per driver, per lane, per week, with the numbers traceable to the loads behind them.' },
  { title: 'Integrations & EDI', body: 'Connect the ELD, fuel card, factoring company and accounting system you already use, with built-in EDI for shippers that require it.' },
];

const AUDIENCES = [
  { name: 'Carriers', body: 'Asset fleets from ten trucks to several hundred.', points: ['Dispatch and planning', 'Driver management and settlement', 'Fleet and safety compliance', 'Accounting and payroll handoff'] },
  { name: 'Brokers', body: 'Non-asset teams covering freight with partner carriers.', points: ['Carrier onboarding and packets', 'Load tendering and coverage', 'Carrier settlement', 'Shipper rate history'] },
  { name: 'Hybrids', body: 'Asset-based brokerages running both books.', points: ['One platform, two divisions', 'Consolidated financials', 'Shared customer records', 'Cross-division dispatch'] },
  { name: 'Private fleets', body: 'Companies hauling their own product.', points: ['Delivery planning', 'Cost per stop and per unit', 'Driver hours and safety', 'Maintenance scheduling'] },
];

const PLANS = [
  { name: 'Starter', for: 'Up to 15 trucks', price: '$39', unit: 'per truck / month', points: ['Dispatch board and load detail', 'Driver app and documents', 'Invoicing and AR aging', 'Email support'], cta: 'Start trial', btnClass: 'btn-secondary' },
  { name: 'Growth', for: '15–100 trucks', price: '$32', unit: 'per truck / month', points: ['Everything in Starter', 'Driver settlements and payroll export', 'Maintenance and compliance registers', 'Reporting suite and open API', 'Live support 7am–7pm CST'], cta: 'Start trial', btnClass: 'btn-primary' },
  { name: 'Enterprise', for: '100+ trucks or multiple divisions', price: 'Custom', unit: 'annual agreement', points: ['Everything in Growth', 'Multi-division consolidation', 'Built-in EDI and custom workflows', 'Dedicated implementation team', 'SSO, MFA and audit logs'], cta: 'Talk to us', btnClass: 'btn-secondary' },
];

const FAQS = [
  { q: 'How is this different from what we have?', a: 'RunTruck is one record per load, from booking through payment. Dispatch, safety and accounting work from that same record, so nothing is re-keyed between systems and nothing gets invoiced twice.' },
  { q: 'Will you move our data?', a: 'Yes. Customers, drivers, trucks, trailers, open loads and unpaid invoices come across before your trial starts, from a spreadsheet or from your current TMS.' },
  { q: 'What does the driver need?', a: 'A smartphone. Drivers accept loads, upload documents, log fuel and view settlements without calling the office.' },
  { q: 'Do you replace our accounting system?', a: 'No. RunTruck handles freight billing and driver settlements, then hands clean entries to QuickBooks or your accounting package.' },
  { q: 'Is there a free trial?', a: 'Fourteen days on your own data, with support included. No card required, and you keep your exports if you leave.' },
  { q: 'How is it priced?', a: 'Per power unit, per month, with driver app seats included. Trailer records, users and documents are not metered.' },
];

const FOOTER = [
  { title: 'Platform', links: ['Dispatch', 'Fleet & safety', 'Driver app', 'Invoicing', 'Reporting', 'Integrations'] },
  { title: 'Who it’s for', links: ['Carriers', 'Brokers', 'Hybrids', 'Private fleets'] },
  { title: 'Company', links: ['Pricing', 'Support', 'Security', 'Contact'] },
];

const bullet = (text: string, key: string | number) => (
  <div key={key} style={{ display: 'flex', gap: 10, padding: '7px 0', borderTop: '1px solid var(--color-divider)', fontSize: 14 }}>
    <span style={{ width: 6, height: 6, background: 'var(--color-accent)', marginTop: 8, flex: 'none' }} />
    <span>{text}</span>
  </div>
);

export function LandingPage() {
  return (
    <div className="site" style={{ maxWidth: 1200, margin: '0 auto', padding: '0 56px' }}>
      <nav className="nav" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <span className="nav-brand" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 15, height: 15, background: 'var(--color-accent)', display: 'block' }} />
          RunTruck
        </span>
        <a href="#platform">Platform</a>
        <a href="#who">Who it&apos;s for</a>
        <a href="#pricing">Pricing</a>
        <a href="#faq">FAQ</a>
        <Link className="btn btn-secondary" href="/app/dashboard">Log in</Link>
        <button className="btn btn-primary" type="button">Start 14-day trial</button>
      </nav>

      <section style={{ padding: '96px 0 72px' }}>
        <h1 className="disp" style={{ fontSize: 'clamp(48px,7vw,92px)', lineHeight: 1.04, marginLeft: '-0.052em' }}>
          <span style={{ display: 'block' }}>Dispatch to cash,</span>
          <span style={{ display: 'block' }}>on one system.</span>
        </h1>
        <p style={{ fontSize: 17, lineHeight: '26px', maxWidth: '58ch', margin: '28px 0 0' }}>
          RunTruck is a transportation management system for trucking companies — loads, drivers, trucks, customers, invoices and driver settlements in one place, so your office stops reconciling spreadsheets and starts closing the week on time.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 28 }}>
          <button className="btn btn-primary" type="button">Start 14-day trial</button>
          <button className="btn btn-secondary" type="button">Book a 20-minute demo</button>
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 28, fontSize: 13, color: 'var(--color-neutral-700)' }}>
          <div>No card required</div><div>Data migration included</div><div>Live support 7am–7pm CST</div>
        </div>
      </section>

      <section style={{ padding: '0 0 84px' }}>
        <Blueprint>
          <header style={{ display: 'flex', flexWrap: 'wrap', borderBottom: '1px solid var(--color-divider)' }}>
            <span className="kick" style={{ flex: 1, minWidth: '16ch', padding: '12px 24px', margin: 0, color: 'var(--color-text)', lineHeight: '24px' }}>RunTruck — operating data</span>
            <span className="kick" style={{ padding: '12px 24px', margin: 0, borderLeft: '1px solid var(--color-divider)', color: 'var(--color-neutral-700)', lineHeight: '24px' }}>RT-100</span>
            <span className="kick" style={{ padding: '12px 24px', margin: 0, borderLeft: '1px solid var(--color-divider)', color: 'var(--color-neutral-700)', lineHeight: '24px' }}>Sheet 01 of 04</span>
          </header>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 72, paddingLeft: 24 }}>No.</th><th style={{ width: '32%' }}>Measure</th><th style={{ width: '22%' }}>Value</th><th>Remark</th>
              </tr>
            </thead>
            <tbody>
              {SPECS.map((s) => (
                <tr key={s.no}>
                  <td className="kick" style={{ padding: '12px 0 12px 24px', margin: 0, lineHeight: '24px' }}>{s.no}</td>
                  <td style={{ fontSize: 15 }}>{s.prop}</td>
                  <td className="num" style={{ fontSize: 24 }}>{s.val}</td>
                  <td style={{ fontSize: 15, color: 'var(--color-neutral-700)' }}>{s.rem}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ margin: 0, padding: '12px 24px', borderTop: '1px solid var(--color-divider)', fontSize: 13, lineHeight: '24px', color: 'var(--color-neutral-700)' }}>
            Figures from customer fleets of 10–350 power units, measured over the first two quarters on the platform.
          </p>
        </Blueprint>
      </section>

      <section id="platform" style={{ padding: '0 0 84px' }}>
        <span className="kick">02 · What the platform holds</span>
        <hr className="rule" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 44 }}>
          {FEATURES.map((f) => (
            <Blueprint key={f.title} style={{ padding: 24 }}>
              <h2 className="disp" style={{ fontSize: 22, lineHeight: '24px' }}>{f.title}</h2>
              <p style={{ fontSize: 15, lineHeight: '24px', margin: '16px 0 0', color: 'var(--color-neutral-800)' }}>{f.body}</p>
            </Blueprint>
          ))}
        </div>
      </section>

      <section id="who" style={{ padding: '0 0 84px' }}>
        <span className="kick">03 · Built for your side of the freight</span>
        <hr className="rule" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 0, border: '1px solid var(--color-divider)' }}>
          {AUDIENCES.map((a) => (
            <div key={a.name} style={{ padding: 24, borderRight: '1px solid var(--color-divider)' }}>
              <h3 className="disp" style={{ fontSize: 21 }}>{a.name}</h3>
              <p style={{ fontSize: 14, lineHeight: '22px', margin: '12px 0 18px', color: 'var(--color-neutral-700)' }}>{a.body}</p>
              {a.points.map((p, i) => bullet(p, i))}
            </div>
          ))}
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0,5fr) minmax(0,7fr)', gap: 64, alignItems: 'center', padding: '0 0 84px' }}>
        <div>
          <span className="kick">04 · From the yard to the office</span>
          <hr className="rule" />
          <h2 className="disp" style={{ fontSize: 34, lineHeight: '36px' }}>The office sees what the truck sees</h2>
          <p style={{ fontSize: 15, lineHeight: '24px', margin: '20px 0 0', maxWidth: '46ch', color: 'var(--color-neutral-800)' }}>
            Drivers send the bill of lading from the cab and it lands on the load. Dispatch sees the stop close, accounting sees an invoice ready to go out — no phone tag, no scanning at the end of the week.
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
            <button className="btn btn-secondary" type="button">See the driver app</button>
          </div>
        </div>
        <Blueprint as="figure" className="duotone" style={{ margin: 0, position: 'relative' }}>
          <div
            style={{
              width: '100%', aspectRatio: '16/10',
              background: 'repeating-linear-gradient(135deg,var(--color-neutral-300) 0 6px,var(--color-neutral-200) 6px 12px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24,
            }}
          >
            <span className="lbl" style={{ color: 'var(--color-neutral-700)' }}>Drop a photo — driver with phone at the trailer</span>
          </div>
        </Blueprint>
      </section>

      <section style={{ padding: '0 0 84px' }}>
        <figure style={{ margin: 0 }}>
          <blockquote className="num" style={{ fontSize: 'clamp(26px,2.8vw,34px)', lineHeight: 1.24, letterSpacing: 0, maxWidth: '38ch', margin: 0, textIndent: '-0.316em' }}>
            “We ran fifteen spreadsheets and a whiteboard. Now settlements take an hour on Monday instead of a day and a half.”
          </blockquote>
          <figcaption style={{ fontSize: 15, lineHeight: '24px', color: 'var(--color-neutral-700)', marginTop: 36, textIndent: '-0.885em' }}>
            — Rosa Medina, dispatch lead, Sunridge Freight (42 trucks)
          </figcaption>
        </figure>
      </section>

      <section id="pricing" style={{ padding: '0 0 84px' }}>
        <span className="kick">05 · Pricing</span>
        <hr className="rule" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 44 }}>
          {PLANS.map((p) => (
            <Blueprint key={p.name} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <h3 className="disp" style={{ fontSize: 22 }}>{p.name}</h3>
                <div style={{ fontSize: 13, color: 'var(--color-neutral-700)', marginTop: 4 }}>{p.for}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, paddingBottom: 16, borderBottom: '1px solid var(--color-divider)' }}>
                <div className="num" style={{ fontSize: 42, lineHeight: 1 }}>{p.price}</div>
                <div style={{ fontSize: 13, color: 'var(--color-neutral-700)' }}>{p.unit}</div>
              </div>
              {p.points.map((x, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, fontSize: 14, lineHeight: '22px' }}>
                  <span style={{ width: 6, height: 6, background: 'var(--color-accent)', marginTop: 8, flex: 'none' }} />
                  <span>{x}</span>
                </div>
              ))}
              <div style={{ flex: 1 }} />
              <button className={`btn ${p.btnClass} btn-block`} type="button">{p.cta}</button>
            </Blueprint>
          ))}
        </div>
        <p style={{ fontSize: 13, lineHeight: '24px', color: 'var(--color-neutral-700)', margin: '20px 0 0' }}>
          Billed per power unit, monthly. Driver app seats, data migration and support are included on every plan.
        </p>
      </section>

      <section id="faq" style={{ padding: '0 0 84px' }}>
        <span className="kick">06 · Questions</span>
        <hr className="rule" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '0 64px' }}>
          {FAQS.map((f) => (
            <div key={f.q} style={{ padding: '20px 0', borderTop: '1px solid var(--color-divider)' }}>
              <h3 className="disp" style={{ fontSize: 19 }}>{f.q}</h3>
              <p style={{ fontSize: 15, lineHeight: '24px', margin: '10px 0 0', color: 'var(--color-neutral-800)' }}>{f.a}</p>
            </div>
          ))}
        </div>
      </section>

      <section style={{ padding: '0 0 72px' }}>
        <span className="kick">07 · Get started</span>
        <hr className="rule" />
        <h3 className="disp" style={{ fontSize: 26 }}>Move your first load on RunTruck this week</h3>
        <p style={{ fontSize: 15, lineHeight: '24px', margin: '16px 0 0', maxWidth: '60ch', color: 'var(--color-neutral-800)' }}>
          We migrate your customers, drivers, trucks and open invoices before your trial starts, so you are looking at your own freight on day one — not a demo account.
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', maxWidth: 480, marginTop: 24 }}>
          <input className="input" type="email" placeholder="you@yourfleet.com" aria-label="Work email" style={{ flex: 1 }} />
          <button className="btn btn-primary" type="button">Start trial</button>
        </div>
      </section>

      <footer style={{ padding: '32px 0', borderTop: '1px solid var(--color-divider)', display: 'flex', flexWrap: 'wrap', gap: 32, fontSize: 13, lineHeight: '24px', color: 'var(--color-neutral-700)' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="num" style={{ fontSize: 17, color: 'var(--color-text)' }}>RUNTRUCK</div>
          <div style={{ marginTop: 6 }}>TMS for trucking companies.</div>
        </div>
        {FOOTER.map((c) => (
          <div key={c.title} style={{ minWidth: 150 }}>
            <div className="kick" style={{ marginBottom: 10 }}>{c.title}</div>
            {c.links.map((l) => (
              <div key={l} style={{ padding: '3px 0' }}>{l}</div>
            ))}
          </div>
        ))}
      </footer>
    </div>
  );
}
