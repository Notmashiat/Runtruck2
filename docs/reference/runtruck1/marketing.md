# Port spec: Marketing site `/` (Runtruck1 to Runtruck2)

Scope: the public landing page served at `/` (`LandingPage`), the `Blueprint` frame component, and every CSS rule that reaches the page (`industry.css`, `app.css`, plus the global parts of `shell.css`). The target is `apps/web` (Next.js App Router) in the Runtruck2 monorepo. The page has to look and behave exactly like Runtruck1, and it also has to follow `docs/02-development-architecture.md` (ARCH).

The root layout, theme boot script, catch-all route, fonts `<link>` and CSS import order are shared with the app shell. They are also specified in `spec/shell.md` §2, §3.1 and §9, and this document agrees with that spec.

**TL;DR**
- The page is **100% static copy**. It has no mock-data import, no hooks, no state and no API calls. It should be a statically rendered **React Server Component** at `apps/web/app/page.tsx`, and **no PostgreSQL data** is involved.
- The only link into the product is **"Log in"**, a `Link` to `/app/dashboard`. Every other CTA (7 buttons plus an email field) is **inert**.
- Dark mode is **not controlled from this page**. It follows `localStorage['runtruck-theme']`, which is set from the app's Settings › Appearance, through `html[data-theme="dark"]` and the token overrides in `app.css`.
- There are **no responsive rules**. Only two `clamp()` font sizes and a few `flex-wrap`s adapt. At phone widths the page overflows horizontally.
- Several visual quirks must be kept on purpose for pixel parity. They are listed in §6, for example nav links in accent-700 (not the text colour the design prototype had), the `td.kick` block-display step in the spec table, and a doubled right border on the audience band.

---

## 1. Files covered

| File | Lines | Role |
|---|---|---|
| `app/src/pages/marketing/LandingPage.tsx` | 253 | The whole page: 6 content constants, a `bullet()` helper, and the `LandingPage` component (named export) |
| `app/src/components/Blueprint.tsx` | 23 | Wireframe frame: `blueprint` class plus 4 `<i class="corner …">` registration marks. Used only by LandingPage |
| `app/src/styles/app.css` | 88 | Marketing dark tokens (`:root[data-theme="dark"]`) plus shared globals, `.num`, `.lbl`, `.kick`, `.rule`, `.disp`, `.site a` |
| `app/src/styles/industry.css` | 285 | "Industry" design system: light tokens, element resets, `.blueprint`, `.corner`, `.duotone`, `.btn*`, `.input`, `.nav*`, `.table` |

Read for context (these files affect the page but are specified mainly in other documents):

| File | Lines | Relevance |
|---|---|---|
| `app/index.html` | 17 | Pre-paint theme script, Google Fonts `<link>`, `<title>RunTruck</title>`, favicon, `#root` |
| `app/src/main.tsx` | 19 | Global CSS import order: `industry.css` → `app.css` → `shell.css` → `calendar.css`; `initTheme()`; `BrowserRouter` |
| `app/src/App.tsx` | 81 | `<Route path="/" element={<LandingPage/>}>` (outside `AppLayout`); catch-all `*` → `<Navigate to="/" replace/>` |
| `app/src/lib/theme.ts` | 31 | `runtruck-theme` storage key, `applyTheme`, `initTheme` |
| `app/src/components/SettingsDialog.tsx` | (shell spec) | The **only** UI that changes the theme (Appearance switch) |
| `app/src/components/Sidebar.tsx` | (shell spec) | "Log out" = `<Link to="/">`, the only way back from the app to this page |
| `app/src/styles/shell.css` | 332 | Only `:root{--ui-*}` and `:root[data-theme="dark"]{color-scheme:dark;…}` are global. Everything else is scoped to `ui-*` classes, so it has no effect on this page |
| `app/src/styles/calendar.css` | 165 | Class-scoped only, so it has no effect on this page |
| `project/RunTruck Site.dc.html` | 257 | Original design prototype, read to diff against the React port (see §6) |
| `app/public/favicon.svg` | n/a | Vite's default purple-bolt logo, used as the tab icon |

---

## 2. Screen specification

### 2.0 Document and global cascade

- `<html lang="en">`. After boot, `<html>` always has `data-theme="light"` or `data-theme="dark"`.
- `<title>RunTruck</title>` is the same for every route. Favicon is `/favicon.svg` (`image/svg+xml`). Viewport meta is `width=device-width, initial-scale=1.0`.
- DOM path: `body > div#root > div.site`. Nothing wraps the page because the landing route is outside `AppLayout`.
- **CSS import order is load-bearing:** `industry.css`, then `app.css`, then `shell.css`, then `calendar.css`. Several `app.css` rules win only because they come later with equal specificity (§2.14).
- Global rules that reach this page, in cascade-resolved form:
  - `*, *::before, *::after { box-sizing: border-box }`
  - `html, body, #root { height: 100%; margin: 0; padding: 0 }`. Content overflows `#root`, and the body background propagates to the canvas, so there is no visible effect.
  - `html { scroll-behavior: smooth }`, which makes the nav hash links animate.
  - `body { background: var(--color-bg); color: var(--color-text); font-family: var(--font-body) /*Barlow*/; font-size: 15px; line-height: 1.55; font-weight: 400; margin: 0; text-wrap: pretty }`
  - `h1–h6 { font-family: "Barlow Condensed"; font-weight: 600; line-height: 1.12; letter-spacing: -0.015em; margin: 0 }`. The `margin: 0` comes from app.css:55, which overrides industry's `0 0 6.8px`. Default sizes are h1 42 / h2 32 / h3 25 / h4 20 / h5 16 / h6 13, but **every heading on the page sets its own inline font-size**.
  - `p { margin: 0 0 10.2px }`. Every `<p>` on the page overrides this inline.
  - `a { color: var(--color-accent-700) } a:hover { color: var(--color-accent-900) }` (app.css). This overrides industry's `a { color: var(--color-accent); text-underline-offset: 3px }`.
  - `figure { margin: 0 }`
  - `figcaption { font-size: 11px; margin-top: 3.4px; color: text@55% }`. All three are overridden inline on the page.
  - `:focus { outline: none } :focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px }`
  - `::selection { background: color-mix(in srgb, var(--color-accent) 30%, transparent) }`
  - `::-webkit-scrollbar { width: 10px; height: 10px } ::-webkit-scrollbar-thumb { background: var(--color-neutral-300) }`. The thumb is square and the track is transparent. In Chromium this scrollbar takes **10px** of layout width. For example, at a 1440px window the layout viewport is 1430px.
  - `:root[data-theme="dark"] { color-scheme: dark; … }` (app.css and shell.css).

### 2.1 Root container

```
<div class="site" style="max-width:1200px; margin:0 auto; padding:0 56px">
  nav · section(hero) · section(spec plate) · section#platform · section#who ·
  section(yard) · section(quote) · section#pricing · section#faq · section(get started) · footer
</div>
```
- With border-box, the content is at most **1088px** wide and centred.
- Vertical rhythm: every section after the hero has `padding: 0 0 84px`. The hero is `96px 0 72px`, "Get started" is `0 0 72px`, and the footer is `32px 0`.
- `.site a { color: var(--color-accent-700); text-decoration: none }` and `.site a:hover { color: var(--color-accent-900) }` (app.css:87-88). These apply to every `<a>` on the page. The only anchors are the 4 nav hash links and "Log in".

### 2.2 Navigation bar (not sticky, no background, no border)

```
<nav class="nav" style="padding-left:0; padding-right:0">
  <span class="nav-brand" style="display:flex; align-items:center; gap:10px">
    <span style="width:15px; height:15px; background:var(--color-accent); display:block"></span>
    RunTruck
  </span>
  <a href="#platform">Platform</a>
  <a href="#who">Who it's for</a>          ← ASCII apostrophe U+0027 here (the footer uses U+2019)
  <a href="#pricing">Pricing</a>
  <a href="#faq">FAQ</a>
  <a class="btn btn-secondary" href="/app/dashboard">Log in</a>     ← react-router <Link to="/app/dashboard">
  <button class="btn btn-primary" type="button">Start 14-day trial</button>
</nav>
```
- `.nav`: `display:flex; align-items:center; gap:13.6px; padding:10.2px 0` (horizontal padding is zeroed inline), `border-bottom:none`.
- `.nav-brand`: Barlow Condensed 600, 18px, `margin-right:auto`, so the brand sits left and the 6 other items sit right-aligned. The brand mark is a 15×15 **square** (no radius) in `--color-accent`, with a 10px gap before "RunTruck". The text is mixed case, not uppercased.
- Nav text links: `.nav a` sets `font-size:14px` and `text-decoration:none`. The **colour is accent-700** (#416180 light, #b8d0f2 dark) and **hover is accent-900** (#1d2d3d / #eef6ff), because `.site a`/`.site a:hover` (app.css) beat `.nav a{color:inherit}` and `.nav a:hover{color:accent}` on source order. Font is Barlow 400. This was verified in Chromium: computed `rgb(65,97,128)`.
- "Log in": `.btn .btn-secondary`. Transparent background, 1px `--color-divider` border, radius 0. Text is Barlow Condensed 600 14px, and its **colour is also accent-700** (from `.site a`, not `--color-text`). Hover: background text@7%, colour accent-900. Active: background text@14%.
- "Start 14-day trial": `.btn .btn-primary`. Background `--color-accent`, text `--color-bg`, border `--color-accent`. Hover background accent-600 (#597ea3, barely different from #5980a6 in light), active accent-700. The border stays `--color-accent`.
- Both buttons are 32.4px tall: padding 6.8px 12.24px, line-height 1.2 × 14px, plus 2px of border. The nav is 52.78px tall.

### 2.3 Hero

```
<section style="padding:96px 0 72px">
  <h1 class="disp" style="font-size:clamp(48px,7vw,92px); line-height:1.04; margin-left:-0.052em">
    <span style="display:block">Dispatch to cash,</span>
    <span style="display:block">on one system.</span>
  </h1>
  <p style="font-size:17px; line-height:26px; max-width:58ch; margin:28px 0 0">RunTruck is a transportation management system for trucking companies — loads, drivers, trucks, customers, invoices and driver settlements in one place, so your office stops reconciling spreadsheets and starts closing the week on time.</p>
  <div style="display:flex; gap:12px; flex-wrap:wrap; margin-top:28px">
    <button class="btn btn-primary" type="button">Start 14-day trial</button>
    <button class="btn btn-secondary" type="button">Book a 20-minute demo</button>
  </div>
  <div style="display:flex; gap:24px; flex-wrap:wrap; margin-top:28px; font-size:13px; color:var(--color-neutral-700)">
    <div>No card required</div><div>Data migration included</div><div>Live support 7am–7pm CST</div>
  </div>
</section>
```
- `.disp`: Barlow Condensed 600, `text-transform:uppercase`, `letter-spacing:0.01em`. The headline renders as **"DISPATCH TO CASH," / "ON ONE SYSTEM."** on two forced lines.
- `margin-left:-0.052em` is an optical overhang of -4.784px at 92px.
- Font size is 48px when the viewport is at most 685.7px wide, `7vw` between that and 1314.3px, and 92px at 1314.3px and wider.
- The secondary hero button has text colour `--color-text`, because it is a `<button>` and not an `<a>`.
- Hero p: 17px/26px, at most 58ch (557px). It wraps to 4 lines at 1440px.

### 2.4 Operating-data spec plate (unnumbered "sheet 01")

```
<section style="padding:0 0 84px">
  <div class="blueprint ">                                   ← Blueprint (div, className '' → trailing space)
    <header style="display:flex; flex-wrap:wrap; border-bottom:1px solid var(--color-divider)">
      <span class="kick" style="flex:1; min-width:16ch; padding:12px 24px; margin:0; color:var(--color-text); line-height:24px">RunTruck — operating data</span>
      <span class="kick" style="padding:12px 24px; margin:0; border-left:1px solid var(--color-divider); color:var(--color-neutral-700); line-height:24px">RT-100</span>
      <span class="kick" style="padding:12px 24px; margin:0; border-left:1px solid var(--color-divider); color:var(--color-neutral-700); line-height:24px">Sheet 01 of 04</span>
    </header>
    <table class="table">
      <thead><tr>
        <th style="width:72px; padding-left:24px">No.</th>
        <th style="width:32%">Measure</th>
        <th style="width:22%">Value</th>
        <th>Remark</th>
      </tr></thead>
      <tbody>  (one row per SPECS item)
        <tr>
          <td class="kick" style="padding:12px 0 12px 24px; margin:0; line-height:24px">{no}</td>
          <td style="font-size:15px">{prop}</td>
          <td class="num" style="font-size:24px">{val}</td>
          <td style="font-size:15px; color:var(--color-neutral-700)">{rem}</td>
        </tr>
      </tbody>
    </table>
    <p style="margin:0; padding:12px 24px; border-top:1px solid var(--color-divider); font-size:13px; line-height:24px; color:var(--color-neutral-700)">Figures from customer fleets of 10–350 power units, measured over the first two quarters on the platform.</p>
    <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
  </div>
</section>
```
- The header renders uppercase through `.kick`: **"RUNTRUCK — OPERATING DATA" | "RT-100" | "SHEET 01 OF 04"**. The first cell is `--color-text`, the other two are neutral-700, and the other two have left dividers. Each cell is 48px tall. The kick font is Barlow at weight 600, which renders with the 700 face (§2.16).
- Table headers render uppercase as **"NO." "MEASURE" "VALUE" "REMARK"**. Style: 11px, `.08em`, Barlow **bold (700, the UA `th` default)**, colour text@60%, padding 6.8px, bottom border `--color-divider`, left-aligned.
- Body cells: padding 6.8px, bottom border text@8%. Rows are 51.79px tall at 1440px.
- The value cell `.num` is Barlow Condensed 600 at 24px with tabular numerals and letter-spacing -0.01em.
- Row hover: `.table tbody tr:hover { background: text@4% }`. This is a visible hover highlight.
- **`td.kick` quirk:** `.kick { display:block }` turns the "No." `<td>` into a block that sits inside an anonymous table cell. It is 49px tall while the row is 51.79px, so its bottom hairline sits about 2.3–2.8px above the row's other hairlines. See §6-B3. Reproduce it with the same markup and CSS.
- Below the last row, the row's text@8% border sits on top of the footnote's `--color-divider` top border, which draws a double hairline.
- Rows (exact strings):

| no | prop (Measure) | val (Value) | rem (Remark) |
|---|---|---|---|
| `01` | `Spreadsheets retired per fleet` | `15+` | `Dispatch, fuel, payroll, IFTA, maintenance` |
| `02` | `Time to invoice a delivered load` | `4 min` | `From POD upload to invoice sent` |
| `03` | `Integrations and open API` | `100+` | `ELD, factoring, fuel cards, accounting, EDI` |
| `04` | `Setup with your own data` | `5 days` | `Migration and training included` |

### 2.5 `#platform`: "02 · What the platform holds"

```
<section id="platform" style="padding:0 0 84px">
  <span class="kick">02 · What the platform holds</span>        ← U+00B7 middle dot, spaces either side
  <hr class="rule">
  <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:44px">
    (per FEATURES item)
    <div class="blueprint " style="padding:24px">
      <h2 class="disp" style="font-size:22px; line-height:24px">{title}</h2>
      <p style="font-size:15px; line-height:24px; margin:16px 0 0; color:var(--color-neutral-800)">{body}</p>
      <i class="corner tl"></i>…<i class="corner br"></i>
    </div>
  </div>
</section>
```
- Section kick (the pattern repeats in #who, yard, #pricing, #faq and Get started): `.kick` is `display:block; font-size:13px; line-height:12px; letter-spacing:.08em; uppercase; font-weight:600; color:accent-700; margin-bottom:12px`. It renders as **"02 · WHAT THE PLATFORM HOLDS"**.
- Rule: `hr.rule` is `height:1px; border:0; margin:0 0 24px; background:var(--color-divider)`. Content starts 49px below the kick's top edge.
- Grid: 3×2 cards, each 333.3×186px at 1440px (all bodies wrap to 4 lines at that width). Titles render uppercase.
- FEATURES (exact):

| title | body |
|---|---|
| `Dispatch & planning` | `One board for every load: assign a driver and trailer, see hours of service before you commit, and watch stops close in real time instead of calling for updates.` |
| `Fleet & safety` | `Trucks, trailers, odometers and service intervals in one register. CDLs, medical cards and annual reviews raise themselves before they expire.` |
| `Driver app` | `Drivers accept loads, photograph the bill of lading, log fuel and check settlements from their phone. The document lands on the load, not in a text thread.` |
| `Invoicing & settlements` | `Invoice a load the moment the POD arrives, run driver pay by mile, percentage or flat rate, and see aging by customer without exporting anything.` |
| `Reporting you can act on` | `Revenue per mile, deadhead, cost per truck and margin by customer — per driver, per lane, per week, with the numbers traceable to the loads behind them.` |
| `Integrations & EDI` | `Connect the ELD, fuel card, factoring company and accounting system you already use, with built-in EDI for shippers that require it.` |

### 2.6 `#who`: "03 · Built for your side of the freight"

```
<section id="who" style="padding:0 0 84px">
  <span class="kick">03 · Built for your side of the freight</span><hr class="rule">
  <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:0; border:1px solid var(--color-divider)">
    (per AUDIENCES item)
    <div style="padding:24px; border-right:1px solid var(--color-divider)">
      <h3 class="disp" style="font-size:21px">{name}</h3>                 ← line-height 1.12 (23.52px) from h rule
      <p style="font-size:14px; line-height:22px; margin:12px 0 18px; color:var(--color-neutral-700)">{body}</p>
      (per point, via bullet(text, index))
      <div style="display:flex; gap:10px; padding:7px 0; border-top:1px solid var(--color-divider); font-size:14px">
        <span style="width:6px; height:6px; background:var(--color-accent); margin-top:8px; flex:none"></span>
        <span>{point}</span>
      </div>
    </div>
  </div>
</section>
```
- These cells are **not** Blueprint frames and have no corner marks. They form one outlined band with vertical dividers.
- The last cell's `border-right` sits next to the container's own right border, which draws a **2px right edge** (§6-B4).
- Bullet rows are 36.7px tall (14px × 1.55 line-height, plus 14px padding, plus a 1px top border). "Driver management and settlement" wraps to 2 lines at 1440px.
- AUDIENCES (exact):

| name | body | points |
|---|---|---|
| `Carriers` | `Asset fleets from ten trucks to several hundred.` | `Dispatch and planning` · `Driver management and settlement` · `Fleet and safety compliance` · `Accounting and payroll handoff` |
| `Brokers` | `Non-asset teams covering freight with partner carriers.` | `Carrier onboarding and packets` · `Load tendering and coverage` · `Carrier settlement` · `Shipper rate history` |
| `Hybrids` | `Asset-based brokerages running both books.` | `One platform, two divisions` · `Consolidated financials` · `Shared customer records` · `Cross-division dispatch` |
| `Private fleets` | `Companies hauling their own product.` | `Delivery planning` · `Cost per stop and per unit` · `Driver hours and safety` · `Maintenance scheduling` |

### 2.7 Yard-to-office split (no id): "04 · From the yard to the office"

```
<section style="display:grid; grid-template-columns:minmax(0,5fr) minmax(0,7fr); gap:64px; align-items:center; padding:0 0 84px">
  <div>
    <span class="kick">04 · From the yard to the office</span><hr class="rule">
    <h2 class="disp" style="font-size:34px; line-height:36px">The office sees what the truck sees</h2>
    <p style="font-size:15px; line-height:24px; margin:20px 0 0; max-width:46ch; color:var(--color-neutral-800)">Drivers send the bill of lading from the cab and it lands on the load. Dispatch sees the stop close, accounting sees an invoice ready to go out — no phone tag, no scanning at the end of the week.</p>
    <div style="display:flex; gap:12px; margin-top:24px">
      <button class="btn btn-secondary" type="button">See the driver app</button>
    </div>
  </div>
  <figure class="blueprint duotone" style="margin:0; position:relative">      ← Blueprint as="figure" className="duotone"
    <div style="width:100%; aspect-ratio:16/10; background:repeating-linear-gradient(135deg,var(--color-neutral-300) 0 6px,var(--color-neutral-200) 6px 12px); display:flex; align-items:center; justify-content:center; text-align:center; padding:24px">
      <span class="lbl" style="color:var(--color-neutral-700)">Drop a photo — driver with phone at the trailer</span>
    </div>
    <i class="corner tl"></i>…<i class="corner br"></i>
  </figure>
</section>
```
- Columns are 426.7 and 597.3px at 1440px. The text column is vertically centred against the 374px-tall figure.
- H2 renders as "THE OFFICE SEES WHAT THE TRUCK SEES" on 2 lines of 36px.
- `.duotone { position:relative; overflow:hidden }` plus `.duotone::after { content:""; position:absolute; inset:0; pointer-events:none; background:var(--color-accent); mix-blend-mode:color }` tints the grey diagonal stripes, the label and the inner halves of the corner marks towards the accent hue. `.blueprint.duotone { overflow:visible }` (specificity 0,2,0) keeps the corner marks visible.
- Stripes: 135°, 6px of neutral-300 then 6px of neutral-200 (#d4d4d7/#e7e7ea light, #2f3a4b/#232c3b dark).
- `.lbl` is 10px, `.12em`, uppercase, Barlow 400. The label renders as **"DROP A PHOTO — DRIVER WITH PHONE AT THE TRAILER"**. This is a design-tool placeholder that visitors can see (§6-C5). No image is loaded.

### 2.8 Testimonial (no id, no kick)

```
<section style="padding:0 0 84px">
  <figure style="margin:0">
    <blockquote class="num" style="font-size:clamp(26px,2.8vw,34px); line-height:1.24; letter-spacing:0; max-width:38ch; margin:0; text-indent:-0.316em">“We ran fifteen spreadsheets and a whiteboard. Now settlements take an hour on Monday instead of a day and a half.”</blockquote>
    <figcaption style="font-size:15px; line-height:24px; color:var(--color-neutral-700); margin-top:36px; text-indent:-0.885em">— Rosa Medina, dispatch lead, Sunridge Freight (42 trucks)</figcaption>
  </figure>
</section>
```
- The blockquote uses `.num`: Barlow Condensed 600 with tabular numerals. Letter-spacing is reset to 0 inline and it is not uppercased.
- Curly quotes are U+201C and U+201D. The negative `text-indent` values make the opening quote and the caption's em dash (U+2014) hang into the margin.
- Font size is 26px at viewport widths up to 928.6px and 34px from 1214.3px up. At 34px the quote is 581px wide (38ch) and wraps to 3 lines.

### 2.9 `#pricing`: "05 · Pricing"

```
<section id="pricing" style="padding:0 0 84px">
  <span class="kick">05 · Pricing</span><hr class="rule">
  <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:44px">
    (per PLANS item)
    <div class="blueprint " style="padding:24px; display:flex; flex-direction:column; gap:16px">
      <div>
        <h3 class="disp" style="font-size:22px">{name}</h3>
        <div style="font-size:13px; color:var(--color-neutral-700); margin-top:4px">{for}</div>
      </div>
      <div style="display:flex; align-items:baseline; gap:8px; padding-bottom:16px; border-bottom:1px solid var(--color-divider)">
        <div class="num" style="font-size:42px; line-height:1">{price}</div>
        <div style="font-size:13px; color:var(--color-neutral-700)">{unit}</div>
      </div>
      (per point)
      <div style="display:flex; gap:10px; font-size:14px; line-height:22px">
        <span style="width:6px; height:6px; background:var(--color-accent); margin-top:8px; flex:none"></span>
        <span>{point}</span>
      </div>
      <div style="flex:1"></div>
      <button class="btn {btnClass} btn-block" type="button">{cta}</button>
      <i class="corner tl"></i>…<i class="corner br"></i>        ← absolutely positioned, so not flex items and no gap
    </div>
  </div>
  <p style="font-size:13px; line-height:24px; color:var(--color-neutral-700); margin:20px 0 0">Billed per power unit, monthly. Driver app seats, data migration and support are included on every plan.</p>
</section>
```
- Pricing bullets differ from the audience `bullet()`: they have **no top border and no 7px padding**, and use line-height 22px.
- Grid items stretch, so all cards are the same height (435.6px at 1440px). The `flex:1` spacer pins the CTA to the bottom.
- `.btn-block` is `width:100%; margin-top:6.8px`.
- The `btnClass` → button style mapping is presentation-only. Only **Growth** is `btn-primary`.
- PLANS (exact):

| name | for | price | unit | points | cta | btnClass |
|---|---|---|---|---|---|---|
| `Starter` | `Up to 15 trucks` | `$39` | `per truck / month` | `Dispatch board and load detail` · `Driver app and documents` · `Invoicing and AR aging` · `Email support` | `Start trial` | `btn-secondary` |
| `Growth` | `15–100 trucks` | `$32` | `per truck / month` | `Everything in Starter` · `Driver settlements and payroll export` · `Maintenance and compliance registers` · `Reporting suite and open API` · `Live support 7am–7pm CST` | `Start trial` | `btn-primary` |
| `Enterprise` | `100+ trucks or multiple divisions` | `Custom` | `annual agreement` | `Everything in Growth` · `Multi-division consolidation` · `Built-in EDI and custom workflows` · `Dedicated implementation team` · `SSO, MFA and audit logs` | `Talk to us` | `btn-secondary` |

### 2.10 `#faq`: "06 · Questions"

```
<section id="faq" style="padding:0 0 84px">
  <span class="kick">06 · Questions</span><hr class="rule">
  <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:0 64px">
    (per FAQS item, key = q)
    <div style="padding:20px 0; border-top:1px solid var(--color-divider)">
      <h3 class="disp" style="font-size:19px">{q}</h3>
      <p style="font-size:15px; line-height:24px; margin:10px 0 0; color:var(--color-neutral-800)">{a}</p>
    </div>
  </div>
</section>
```
- The FAQ is always expanded. There is no accordion and no interaction.
- The grid fills row-major, so items 1 and 2 share a row, then 3 and 4, then 5 and 6. Each column is 512px at 1440px. Questions render uppercase.
- FAQS (exact):

| q | a |
|---|---|
| `How is this different from what we have?` | `RunTruck is one record per load, from booking through payment. Dispatch, safety and accounting work from that same record, so nothing is re-keyed between systems and nothing gets invoiced twice.` |
| `Will you move our data?` | `Yes. Customers, drivers, trucks, trailers, open loads and unpaid invoices come across before your trial starts, from a spreadsheet or from your current TMS.` |
| `What does the driver need?` | `A smartphone. Drivers accept loads, upload documents, log fuel and view settlements without calling the office.` |
| `Do you replace our accounting system?` | `No. RunTruck handles freight billing and driver settlements, then hands clean entries to QuickBooks or your accounting package.` |
| `Is there a free trial?` | `Fourteen days on your own data, with support included. No card required, and you keep your exports if you leave.` |
| `How is it priced?` | `Per power unit, per month, with driver app seats included. Trailer records, users and documents are not metered.` |

### 2.11 Get started (no id): "07 · Get started"

```
<section style="padding:0 0 72px">
  <span class="kick">07 · Get started</span><hr class="rule">
  <h3 class="disp" style="font-size:26px">Move your first load on RunTruck this week</h3>
  <p style="font-size:15px; line-height:24px; margin:16px 0 0; max-width:60ch; color:var(--color-neutral-800)">We migrate your customers, drivers, trucks and open invoices before your trial starts, so you are looking at your own freight on day one — not a demo account.</p>
  <div style="display:flex; gap:12px; align-items:stretch; max-width:480px; margin-top:24px">
    <input class="input" type="email" placeholder="you@yourfleet.com" aria-label="Work email" style="flex:1">
    <button class="btn btn-primary" type="button">Start trial</button>
  </div>
</section>
```
- `.input`: `width:100%; min-height:36px; padding:6px 10px; font:inherit; font-size:14px; color:text; caret-color:accent; background:var(--color-surface); border:1px solid divider; border-radius:0`. Hover border is text@45%. Focus-visible sets the border to accent, with a 2px accent outline at offset 0.
- The row is 480×36. The input is 394px wide and the button is stretched to 36px tall (it is 32.4px elsewhere).
- There is **no `<form>`**. Pressing Enter does nothing, nothing is validated, and the value is discarded.

### 2.12 Footer

```
<footer style="padding:32px 0; border-top:1px solid var(--color-divider); display:flex; flex-wrap:wrap; gap:32px; font-size:13px; line-height:24px; color:var(--color-neutral-700)">
  <div style="flex:1; min-width:220px">
    <div class="num" style="font-size:17px; color:var(--color-text)">RUNTRUCK</div>     ← literal uppercase text
    <div style="margin-top:6px">TMS for trucking companies.</div>
  </div>
  (per FOOTER column)
  <div style="min-width:150px">
    <div class="kick" style="margin-bottom:10px">{title}</div>
    (per link) <div style="padding:3px 0">{label}</div>          ← plain text, NOT links
  </div>
</footer>
```
- FOOTER (exact):
  - `Platform`: `Dispatch`, `Fleet & safety`, `Driver app`, `Invoicing`, `Reporting`, `Integrations`
  - `Who it’s for` (**U+2019** curly apostrophe; the kick uppercases it to "WHO IT’S FOR"): `Carriers`, `Brokers`, `Hybrids`, `Private fleets`
  - `Company`: `Pricing`, `Support`, `Security`, `Contact`
- At 1440px the brand column is 542px (flex:1) and the other three columns are 150px each. The footer is 267px tall.
- The footer's first child (the brand column) has no `.kick`. Footer column kicks are accent-700.

### 2.13 `Blueprint` component

```tsx
interface BlueprintProps { as?: ElementType; className?: string; style?: CSSProperties; children: ReactNode; onClick?: () => void }
// renders:
<{as ?? 'div'} className={`blueprint ${className ?? ''}`} style={style} onClick={onClick}>
  {children}
  <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
</{as}>
```
- The corners always come **after** the children.
- When `className` is empty the class attribute ends in a trailing space (`"blueprint "`).
- It is used 10 times on the page: 1 spec plate, 6 features, 1 figure (`as="figure" className="duotone"`) and 3 plans.
- CSS:
  - `.blueprint { position:relative; border:1px solid var(--color-divider); border-radius:0 }`
  - `.blueprint > .corner { position:absolute; width:11px; height:11px; color: text@55% }`
  - `::before` draws a 1px vertical bar at left:5px, full height. `::after` draws a 1px horizontal bar at top:5px, full width. Both use `background: currentColor`.
  - `.tl{top:-6px;left:-6px}`, `.tr{top:-6px;right:-6px}`, `.bl{bottom:-6px;left:-6px}`, `.br{bottom:-6px;right:-6px}`.
  - The result is a "+" centred on each outer corner of the 1px border.
- `onClick` is never used anywhere. It is dead API; keep the prop only if needed.

### 2.14 CSS class inventory for this page (cascade-resolved)

| Class | Source | Resolved declarations on this page |
|---|---|---|
| `.site` | app.css:87-88 | Only as the `.site a` / `.site a:hover` scope |
| `.nav`, `.nav-brand`, `.nav a` | industry.css:235-245 | See §2.2. **`.nav a` colour and hover lose to `.site a`** (equal specificity 0,1,1, app.css loads later) |
| `.btn` | industry.css:139-150,280,282 | inline-flex centred, gap 6px, pointer, no underline, Barlow Condensed 600 14px/1.2, colour text, transparent background, **1px divider border, radius 0**, padding 6.8px 12.24px; `:disabled` opacity .45 (unused) |
| `.btn-primary` | :151-153,283 | background accent, colour bg, border accent; hover accent-600; active accent-700 |
| `.btn-secondary` | :154-156 | border divider; hover text@7%; active text@14% |
| `.btn-block` | :161 | width 100%; margin-top 6.8px |
| `.input` | :168-175,280 | §2.11 |
| `.table`, `th`, `td`, `tbody tr:hover` | :248-258 | §2.4 |
| `.blueprint`, `.corner.*` | :72-94 | §2.13 |
| `.duotone` (+ `.blueprint.duotone`) | :81,96-98 | §2.7 |
| `.kick` | app.css:77-81 | §2.5 (also used on `td` and header `span`s) |
| `.rule` | app.css:82 | §2.5 |
| `.disp` | app.css:83-86 | Barlow Condensed 600, uppercase, `.01em` (beats the h rule's `-0.015em`) |
| `.num` | app.css:57-62 | Barlow Condensed 600, tabular numerals, `-0.01em` (the blockquote overrides this to 0 inline) |
| `.lbl` | app.css:63-67 | 10px, `.12em`, uppercase |

industry.css classes the page does **not** use: `.hr`, `.btn-ghost`, `.btn-icon`, `.field`, `.radio`/`.dot`, `.seg`/`.seg-opt`, `.card*`, `.elev-*`, `.tag*`, `.dialog*`, `.text-muted`, `.halftone`/`.plate` (these two appear only inside a selector). Copy both files **verbatim** anyway; the shell spec also relies on them being global.

### 2.15 Token values used (light = `:root` in industry.css; dark = `:root[data-theme="dark"]` in app.css)

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--color-bg` | `#f2f2f3` | `#0f141c` | page background, primary-button text |
| `--color-surface` | `#e9e9ea` | `#171e2a` | email input background |
| `--color-text` | `#1d1f20` | `#e6e9ef` | body text, "RUNTRUCK", spec header cell 1 |
| `--color-accent` | `#5980a6` | `#7aa2ff` | brand square, bullets, primary buttons, duotone, focus ring, caret |
| `--color-divider` | `color-mix(in srgb,#1d1f20 16%,transparent)` | `color-mix(in srgb,#e6e9ef 16%,transparent)` | all hairlines and borders |
| `--color-neutral-200` / `-300` | `#e7e7ea` / `#d4d4d7` | `#232c3b` / `#2f3a4b` | photo stripes; the scrollbar thumb uses -300 |
| `--color-neutral-700` | `#5d5d60` | `#aab4c2` | secondary copy |
| `--color-neutral-800` | `#424244` | `#cbd3dd` | body paragraphs in features, yard, FAQ and CTA |
| `--color-accent-600` | `#597ea3` | `#94b3e0` | primary hover |
| `--color-accent-700` | `#416180` | `#b8d0f2` | kicks, links, "Log in" text, primary active |
| `--color-accent-900` | `#1d2d3d` | `#eef6ff` | link hover |

Derived colours: text@55% for corners, text@60% for th, text@8% for td borders, text@4% for row hover, text@7% and 14% for secondary hover and active, text@45% for input hover, accent@30% for selection. All are `color-mix(in srgb, var(--color-text) N%, transparent)`.

The full ramps (`accent-2-*`, shadows, and so on) are listed in `spec/shell.md` §5.4. None of them are used on this page.

### 2.16 Typography and fonts

- The fonts come from a Google Fonts stylesheet: `https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;700&family=Barlow+Condensed:wght@400;600&family=Inter:wght@400;500;600;700&display=swap`, with `preconnect` to `fonts.googleapis.com` and to `fonts.gstatic.com` (crossorigin).
- Faces this page actually renders, verified in Chromium: **Barlow 400**, **Barlow 700** and **Barlow Condensed 600**.
- **Barlow 600 is not loaded.** `.kick` (weight 600, Barlow family) therefore resolves to the **700 face** under CSS font matching, and `th` (UA bold) uses 700 too. If a port loads Barlow 600, every kick gets lighter. Load exactly these weights.
- `display=swap` means text renders in a fallback font first and swaps once the webfont arrives.
- Inter is loaded but only the app uses it.

### 2.17 Responsive behaviour (there are no media queries on this page)

- The only fluid pieces are the h1 `clamp(48px,7vw,92px)`, the blockquote `clamp(26px,2.8vw,34px)`, `flex-wrap` on the hero CTA row, hero notes, spec header and footer, the footer `min-width`s, and the `max-width:1200px` container with a fixed 56px side padding.
- The grids are fixed at 3, 4, 5fr/7fr, 3 and 2 columns at every width. `1fr` is `minmax(auto,1fr)`, so long words force overflow.
- The nav never wraps as a row. Its items shrink and wrap their own text.
- At a 375px mobile viewport (Chromium mobile emulation):
  - The document grows to about **681px wide** because Chrome widens the layout viewport to fit overflowing content, and the page is zoomed out.
  - The content box is 263px. Pricing cards reach x≈676 and the audience band x≈623.
  - "Who it's for" wraps to 3 lines and "Start 14-day trial" to about 83px tall.
  - h1 is 48px and the blockquote 26px.
  - Narrow desktop windows get a horizontal scrollbar instead.
- To be identical, reproduce this as is. Adding breakpoints is a design change that needs sign-off (§6-B6).

### 2.18 Dark-mode behaviour

- **Trigger:** `html[data-theme="dark"]`. The marketing page has **no toggle**. The only switch is the app's Settings › Appearance (`applyTheme`), which writes `localStorage['runtruck-theme']`.
- **Boot:** an inline `<head>` script sets `data-theme="dark"` before first paint when the stored value is `'dark'`. `initTheme()` then always sets `light` or `dark`.
- `prefers-color-scheme` is **ignored**, so OS dark mode has no effect.
- In dark mode, every token in §2.15 swaps (the ramps are inverted) and `color-scheme: dark` is set. That dark scheme affects UA-drawn parts: the input placeholder, autofill and the native caret.
- Buttons in dark mode: primary is `#0f141c` text on `#7aa2ff`. Secondary is light text on transparent. "Log in" and the nav links are `#b8d0f2`.
- The duotone blends `#7aa2ff` over the dark stripes.

### 2.19 Reference geometry (Chromium, 1440×900 window, 1430px layout width after the 10px scrollbar, fonts loaded, light)

Use this table for visual QA of the port.

| Block | top y | height | notes |
|---|---|---|---|
| `.site` | 0 | 4473.6 | x 115 to 1315; content x 171 to 1259 (1088 wide) |
| nav | 0 | 52.8 | "Platform" x 839.8; "Log in" 56.3×32.4; "Start 14-day trial" 109.2×32.4 |
| hero | 52.8 | 599.9 | h1 at 148.8, 191.4 tall (2 × 95.68); p at 368.1, 557×104; CTA row at 500.1; notes at 560.5 (20.1 tall) |
| spec plate section | 652.7 | 422.8 | plate 338.8; header cells 48; th row 31.1; rows 51.8 each; footnote 49 |
| #platform | 1075.5 | 549 | kick 12, rule at +24, cards at +49; cards 333.3×186, row gap 44 |
| #who | 1624.5 | 449 | band 1088×316; cells 271.5 wide |
| yard | 2073.5 | 458.1 | text column 426.7 (top 2113.8); figure 597.3×374.1 |
| quote | 2531.5 | 270.5 | blockquote 581.4×126.5 (3 lines × 42.16); caption at 2694 |
| #pricing | 2802 | 612.6 | cards 333.3×435.6; buttons 283.3×32.4 at y 3229.2; note at 3306.6 |
| #faq | 3414.6 | 517.8 | items 512 wide; row heights 144.3 / 120.3 / 120.3 |
| get started | 3932.5 | 274.1 | h3 29.1; p 508.5×48; form row 480×36 at 4098.6 |
| footer | 4206.6 | 267 | columns at x 171 (542 wide), 745, 927, 1109 (150 each) |

---

## 3. Data contract

**The backend serves nothing to this page.** LandingPage imports no module from `app/src/data/*`. It does not use "today" (2026-09-03), does not read the session, and makes no fetch. All content lives in 6 module-level constants in `LandingPage.tsx`:

| Constant | Shape | Count | Where it renders |
|---|---|---|---|
| `SPECS` (l.4-9) | `{no, prop, val, rem}` (all strings) | 4 | Spec plate rows (§2.4) |
| `FEATURES` (l.11-18) | `{title, body}` | 6 | #platform cards (§2.5) |
| `AUDIENCES` (l.20-25) | `{name, body, points: string[4]}` | 4 | #who band (§2.6) |
| `PLANS` (l.27-31) | `{name, for, price, unit, points: string[], cta, btnClass}` | 3 | #pricing (§2.9) |
| `FAQS` (l.33-40) | `{q, a}` | 6 | #faq (§2.10) |
| `FOOTER` (l.42-46) | `{title, links: string[]}` | 3 | footer columns (§2.12) |

- **Derived or computed values: none.** Every number shown is a literal string, including "15+", "4 min", "100+", "5 days", "$39", "$32", "Custom", "10–350", "42 trucks" and "Fourteen days". Nothing is summed, counted, formatted or date-dependent. Uppercasing is done by CSS (`.disp`, `.kick`, `th`, `.lbl`), and the data keeps its mixed case. The `btnClass` → button style mapping is presentation.
- **Authoritative business or financial calculations: none on this page.**
  - Flag: the plan prices (`$39`, `$32` "per truck / month") are **display copy only**. If Runtruck ever bills subscriptions, the authoritative price list must live in the backend billing configuration, and this page must never be used as the source for charging.
- **Where it should live in Runtruck2:** this is marketing copy, not tenant-owned business data. ARCH Rule 1 covers business data, so the copy does **not** belong in PostgreSQL. Keep it as typed constants in `apps/web`, for example `apps/web/app/(marketing)/content.ts` or next to the page, with `as const`. A CMS is out of scope and would need approval under ARCH §40.
- **Future backend touchpoints.** These do not exist in the prototype. List them only if the product owner wants the CTAs wired, and see §6-C2.
  - Trial signup or demo request would be a **public, unauthenticated** `POST /api/v1/public/trial-requests` (a name to be agreed). It would take the body `{ email }` validated with Zod (`z.string().email()`), return a `{data:{id}, meta:{}}` envelope, be rate-limited, write to a non-tenant `leads` table (UUID, `created_at` UTC), and emit an event such as `TrialRequested`.
  - ARCH defines no public or unauthenticated endpoints and no leads table, which is a gap to resolve. `docs/03-database.md` does not exist yet.

---

## 4. Interactions and state

| Element | Trigger | Behaviour | State touched | Class |
|---|---|---|---|---|
| Nav "Platform" / "Who it's for" / "Pricing" / "FAQ" | click / Enter | Native in-page anchor to `#platform` / `#who` / `#pricing` / `#faq`. **Smooth-scrolls** (`html{scroll-behavior:smooth}`) so the section's top edge meets the viewport top (no sticky header, no scroll-margin). The URL hash is updated and a history entry is pushed | URL hash | (b) presentation |
| Nav "Log in" | click / Enter | Client-side navigation to **`/app/dashboard`** (react-router `Link`: pushState, no reload). The window scroll is not reset by RR, but the app shell is 100vh with an internal scroller, so this has no visible effect | route | (b). Under ARCH it must pass the server-side auth gate (§6-C1) |
| "Start 14-day trial" (nav + hero), "Book a 20-minute demo", "See the driver app", "Start trial" ×2 (Starter, Growth), "Talk to us", "Start trial" (CTA row) | click | **No-op.** Each is `type="button"` with no handler | none | n/a |
| Email input (`type=email`, placeholder `you@yourfleet.com`, `aria-label="Work email"`) | typing / Enter | An uncontrolled DOM value. There is no form, so Enter does nothing; there is no validation, it is never read, and it is lost on navigation or reload. UA email-type validation never runs because nothing submits | DOM only | (b) ephemeral |
| Spec table rows | hover | Row background text@4% | CSS only | (b) |
| Buttons / links / input | hover / active / focus-visible | §2.2, §2.11, §2.14 | CSS only | (b) |
| Footer column items | n/a | Plain `<div>` text: not focusable, no hover, no href | none | n/a |
| Theme | (outside the page) | Read at boot from `localStorage['runtruck-theme']` → `html[data-theme]` | localStorage | (b) device-local presentation preference. It may stay in the browser (ARCH §5 "client-side presentation state") |
| Any unknown URL | navigation | Catch-all `*` → `<Navigate to="/" replace/>` lands on this page (history replace, query and hash dropped) | route | (b) |

**Keyboard tab order:** Platform → Who it's for → Pricing → FAQ → Log in → Start 14-day trial (nav) → Start 14-day trial (hero) → Book a 20-minute demo → See the driver app → Start trial (Starter) → Start trial (Growth) → Talk to us → email input → Start trial. The brand, spec plate, cards and footer are not focusable. Focus is shown only with `:focus-visible`: a 2px accent outline at offset 2px (offset 0 on the input).

**Business data mutated by this page: none.** It holds no React state at all (no `useState`, no context), so nothing needs PostgreSQL.

---

## 5. Porting hazards (Next.js App Router)

1. **react-router usage:** only `import { Link } from 'react-router-dom'` for "Log in" (`to="/app/dashboard"`). Replace it with `next/link` `<Link href="/app/dashboard" className="btn btn-secondary">Log in</Link>`, which renders the same `<a class="btn btn-secondary" href="/app/dashboard">`.
   - Next `Link` prefetches in production when the link is in the viewport. If `/app/dashboard` is auth-gated and dynamic, the prefetch is harmless, but consider `prefetch={false}` to avoid gate or middleware noise.
   - Next scrolls the window to top on navigation, which RR did not. There is no visible difference because the link is only reachable at the top.
   - The route itself (`App.tsx:31`, outside `AppLayout`) maps to `apps/web/app/page.tsx`. The catch-all maps to `app/[...rest]/page.tsx` → `redirect('/')` (shell spec §3.1).
2. **Keep the hash links as plain `<a href="#…">`**, not `next/link`. Native anchors keep browser-native smooth scrolling and hash history. Next's router-driven hash scrolling differs in timing and history handling.
3. **Default export.** Next pages need `export default`. The prototype's `LandingPage` is a named export.
4. **Server Component.** The page and `Blueprint` use no hooks, no `window`, `document` or `localStorage`, and no event handlers, so both can be RSC with no `'use client'`. `as="figure"` (a string) is serialisable. **Do not pass `onClick` to `Blueprint` from a Server Component**; it would throw. The prop is unused, so drop it or make a client variant. Mark the page static, for example with `export const dynamic = 'force-static'`. Do **not** read `cookies()` in the root layout for the theme, because that makes `/` dynamic.
5. **Theme without flash (shared with the shell):** put an inline script first in the root layout `<head>`: `try{document.documentElement.dataset.theme=localStorage.getItem('runtruck-theme')==='dark'?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}`, and add `suppressHydrationWarning` on `<html>`. `initTheme()` in `main.tsx` touches `document` at module scope, which is illegal under SSR, so do not port it as-is.
6. **Global CSS order:** import `industry.css`, `app.css`, `shell.css`, `calendar.css` **once, in that order, in the root layout**.
   - The nav link colour (accent-700) exists *only* because `.site a` in app.css comes after `.nav a` in industry.css. Any reordering, for example marketing-only CSS in a route-group layout or CSS chunk reordering, silently changes the nav and "Log in" colours.
   - Verify in `next build` output. If chunking reorders, set `experimental.cssChunking: 'strict'`.
   - Client navigation from `/app` back to `/` keeps shell stylesheets loaded. That is harmless because they are class-scoped.
7. **`#root` selector:** `app.css:53` targets `#root`. Wrap `{children}` in `<div id="root">` in the root layout (shell spec §9-8) so the DOM stays `body > #root > .site`.
8. **`html{scroll-behavior:smooth}`:** add `data-scroll-behavior="smooth"` on `<html>` so Next disables smooth scrolling only during route transitions (Next ≥15.4/16 behaviour). In-page hash links stay smooth.
9. **Fonts:**
   - `next/font/google` renames font families and injects size-adjusted fallbacks. The CSS hardcodes `"Barlow Condensed"` (in `.num`, `.disp`, `--font-heading`) and `"Barlow"` (in `--font-body`), so `next/font` would break those names unless the CSS is rewritten to variables.
   - It would also tempt loading **Barlow 600**, which changes every `.kick` (§2.16).
   - For identical output, keep the same `<link>` and preconnects in the root layout `<head>`. That may trip `@next/next` lint rules about custom font links; suppress them with a justification.
10. **ESLint `react/no-unescaped-entities`** (in `next/core-web-vitals`) errors on the ASCII apostrophe in `Who it's for` (LandingPage.tsx:64). Fix it with `Who it&apos;s for` or `{"Who it's for"}`. **Do not** switch to `’`: the nav uses U+0027 and the footer uses U+2019, and the difference is visible.
11. **CSS transforms by Next's pipeline** (PostCSS or Lightning CSS under Turbopack, with the default browserslist) may add fallbacks for `color-mix()` with literal colours, `inset`, `aspect-ratio` and `text-wrap`. The results are equivalent, but diff the computed colours in QA (§2.15).
12. **Native `<dialog>`, `window`, `document`, `localStorage`:** none are used on this page, apart from the theme boot covered in hazard 5.
13. **Metadata:** `export const metadata = { title: 'RunTruck', icons: { icon: { url: '/favicon.svg', type: 'image/svg+xml' } } }` in the root layout, with no per-page title. Remove the `app/favicon.ico` that create-next-app adds, or it overrides the SVG.
14. **URL segment `app`:** the dashboard lives at `apps/web/app/app/dashboard/page.tsx`. That is legal, but keep the marketing page at `apps/web/app/page.tsx` so it doesn't end up inside the `/app` auth layout.
15. **SSR text:** there is no locale- or time-dependent text, so there is no hydration risk.

---

## 6. Bugs, inconsistencies and architecture conflicts

### A. Drift from the design prototype (`project/RunTruck Site.dc.html`)
The React app is the parity target, so keep its behaviour, but get sign-off on these differences.

1. **Nav link colour.** In the prototype, `a{color:accent-700}` (element selector, line 22) lost to `.nav a{color:inherit}`, so the nav links were **text colour** with an accent hover. In the port, `.site a` (app.css:87) beats `.nav a` (industry.css:244), so they render **accent-700** with an **accent-900** hover (LandingPage.tsx:63-67).
2. **"Log in"** was a `<button>` with text colour in the prototype (line 37). It is now an `<a>` coloured accent-700 (LandingPage.tsx:67), which is visually inconsistent with the neighbouring "Book a 20-minute demo" secondary button, drawn in text colour.
3. **The photo slot** was a droppable `<image-slot>` in the prototype (line 129). It is now a static striped placeholder that still shows the design-tool instruction "Drop a photo — driver with phone at the trailer" (LandingPage.tsx:165).
4. `.num` gained `letter-spacing:-0.01em` (app.css:61), which the prototype lacked (line 18). This affects spec values, prices and "RUNTRUCK". The blockquote resets it to 0.

### B. Visual bugs to keep for pixel parity
Fix these only with approval.

1. There are no `@media` rules anywhere on the page, so it is **not responsive** (§2.17). At 375px it overflows to about 681px.
2. There is no `scroll-margin-top` on the anchors. That is fine today because the nav is not sticky.
3. **`td.kick` is block-level** (LandingPage.tsx:104 with app.css:78 `display:block`). The "No." cell is wrapped in an anonymous table cell, and its bottom hairline sits about 2.5px above the rest of the row line on every spec row.
4. **Doubled right edge** on the audience band: the last cell's `borderRight` (LandingPage.tsx:136) sits next to the container `border` (line 134), which draws a 2px edge.
5. **Double hairline** under the last spec row: the td border at 8% (industry.css:256) sits above the footnote's `borderTop` at 16% (LandingPage.tsx:112).
6. **Primary hover is almost invisible in light mode**: `#5980a6` becomes `#597ea3` (industry.css:152, 27).
7. **The duotone overlay also tints the inner halves of the figure's corner marks**, because `::after` paints over the absolutely positioned `<i>` corners (industry.css:97).

### C. Architecture and product conflicts (ARCH)

1. **No authentication behind "Log in".** It links straight to `/app/dashboard` (LandingPage.tsx:67), and "Log out" is just `<Link to="/">` (Sidebar.tsx:47). ARCH §11/§12 and Phase 2 require backend-enforced sessions. The port needs a server-side gate on `/app/*` and a login screen, **for which no reference design exists**. The product owner must decide, as also raised in shell spec §8.
2. **Every conversion CTA is inert** (LandingPage.tsx:68, 80, 81, 154, 202, 232-233). If trial signup or demo booking is ever implemented, it creates persisted data (a lead or trial request) that must go through the API with Zod validation, rate limiting and PostgreSQL, never browser storage (ARCH Rule 1, §16). ARCH defines no unauthenticated public endpoints and no `leads` or trial table, which is a gap. The trial flow ("we migrate your data before your trial starts") also implies organization provisioning (ARCH §10), which is unspecified.
3. **Marketing claims capabilities that don't exist.** Examples: "100+" integrations and an open API (l.7), ELD, factoring and fuel-card integrations, built-in EDI (l.17, 30), a QuickBooks hand-off (l.37), "SSO, MFA and audit logs" (l.30), a driver app (l.14; the mobile app is Phase 9), and hours-of-service checks (l.12). ARCH §25/§43 forbid assuming an integration exists. Publishing these claims is a product and legal decision.
4. **Fabricated proof points.**
   - The testimonial "— Rosa Medina, dispatch lead, Sunridge Freight (42 trucks)" (l.173-176) and the statistics "Figures from customer fleets of 10–350 power units…" (l.113) are invented.
   - The design chat says to "swap in your real numbers before it goes anywhere public."
   - They must not ship to production as genuine.
5. **Placeholder copy is visible to visitors.** "Drop a photo — driver with phone at the trailer" (l.165), plus "RT-100" and "Sheet 01 of 04" when only one sheet exists (l.92-93).
6. **Copy inconsistencies.**
   - Tiers overlap at the boundaries: "Up to 15 trucks" vs "15–100 trucks" vs "100+ trucks" (l.28-30).
   - The hero promises "Live support 7am–7pm CST" to everyone (l.84), but Starter only includes "Email support" (l.28).
   - The pricing note says "support [is] included on every plan" (l.207), which is true only loosely.
   - "Who it's for" (nav, ASCII apostrophe, l.64) vs "Who it’s for" (footer, curly apostrophe, l.44).
7. **Accessibility.**
   - Section labels are `<span>`s, not headings, and heading levels jump h1 → h2 → h3 → h2 → h3.
   - The `<nav>` has no `aria-label`, and there is no skip link.
   - Footer "links" are non-interactive `<div>`s that look like link lists (l.245-247).
   - Buttons do nothing and give no feedback.
   - The email input has no `<form>`, no `name` and no `autocomplete="email"`.
   - The kick colour on bg (#416180 on #f2f2f3) is about 5.8:1 and passes contrast checks.
8. **The favicon is the stock Vite logo** (`public/favicon.svg`), not RunTruck branding. `public/icons.svg` is unused Vite template content.
9. **Theme discoverability.** Dark mode for the marketing page can only be switched on from inside the (soon auth-gated) app, and OS `prefers-color-scheme` is ignored. The comment in app.css:8 ("Toggled from Settings › Appearance") confirms this is intended.
10. **Dead API.** `Blueprint`'s `onClick` prop is never used, and its class string has a trailing space (Blueprint.tsx:13-15). The `bullet()` helper (l.48-53) nearly duplicates the pricing bullet markup (l.196-199) with different padding and border.
11. **Missing docs.** ARCH §48 lists `docs/03-database.md`, `04-api.md` and the rest, and none of them exist in Runtruck2 yet. Nothing on this page depends on them, except the future lead endpoint in C2.

---

## 7. Suggested Runtruck2 implementation

```
apps/web/
  app/layout.tsx          ← shared root (shell spec §3.1): <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">,
                             theme script first in <head>, Google Fonts preconnects + <link>, metadata (title, favicon),
                             import '../styles/industry.css'; '../styles/app.css'; '../styles/shell.css'; '../styles/calendar.css' (this order),
                             <body><div id="root">{children}</div></body>
  app/page.tsx            ← export default function LandingPage() — RSC, static; markup exactly as §2.1–§2.12
  app/[...rest]/page.tsx  ← redirect('/')  (catch-all parity)
  components/marketing/Blueprint.tsx   ← RSC version (as/className/style/children), identical output incl. trailing space
  app/(content)/landing.ts or components/marketing/content.ts ← SPECS, FEATURES, AUDIENCES, PLANS, FAQS, FOOTER (verbatim, `as const`)
  styles/industry.css, styles/app.css  ← verbatim copies (industry.css = bundle copy minus the @import of fonts)
  public/favicon.svg                   ← verbatim
```
- Keep the inline `style` objects exactly as in §2. Converting them to CSS modules is allowed only if the computed values stay identical. The simplest route is to keep the JSX unchanged.
- `packages/ui` could host `Blueprint` if the product later uses it in the app. Today it is marketing-only.
- No API client, no data fetching and no auth on `/`.
- `/` should be publicly cacheable (static HTML).

---

## 8. Acceptance checklist (marketing)

- [ ] `/` renders with no network calls other than fonts, CSS and the favicon, both logged out and logged in. The page is statically generated.
- [ ] The DOM is `body > #root > div.site` with the 11 children in the order of §2.1. Every string matches §2 exactly, including U+00B7, U+2013, U+2014, U+2019 and U+201C/D, and the ASCII apostrophe in the nav.
- [ ] The computed nav link colour is `rgb(65,97,128)` (light) or `rgb(184,208,242)` (dark), and "Log in" has the same colour.
- [ ] "Log in" navigates to `/app/dashboard`, which goes through the Runtruck2 auth gate. Hash links smooth-scroll to `#platform`, `#who`, `#pricing` and `#faq`.
- [ ] All 8 CTAs are inert and the email input has no form (unless the product owner approves wiring, §6-C2).
- [ ] Only the fonts Barlow 400/700 and Barlow Condensed 600 render, and kicks use the 700 face.
- [ ] The geometry at 1440×900 matches §2.19 within ±1px, and the h1 and blockquote clamps behave per §2.3 and §2.8.
- [ ] Dark mode: with `localStorage['runtruck-theme']='dark'` there is no light flash on load, and the tokens match §2.15. With no stored value, the page is light regardless of the OS setting.
- [ ] The quirks in §6-B are present, unless explicitly approved for fixing.
- [ ] Lint and typecheck pass with strict TypeScript (ARCH §39), with no `'use client'` on the page.
