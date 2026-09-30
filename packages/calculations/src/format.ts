// Display formatters that reproduce Runtruck1's strings exactly
// (docs/reference/runtruck1/data-model.md §2.3–2.6; the F-* codes below).
// The API returns raw values (cents, ISO dates, minutes); only the web formats.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const EM_DASH = '—';

const pad2 = (n: number) => String(n).padStart(2, '0');

function parseIsoDate(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y: y ?? 0, m: m ?? 1, d: d ?? 1 };
}

// F-MONEY — Runtruck1's money(n) = `$${n.toLocaleString('en-US')}` with n in dollars.
export function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US')}`;
}

// F-SIGNED — negatives print '-$142'; zero prints '—' (Payroll deductions, New Load margin).
export function formatSignedMoney(cents: number, zeroAsDash = false): string {
  if (zeroAsDash && cents === 0) return EM_DASH;
  return cents < 0 ? `-${formatMoney(-cents)}` : formatMoney(cents);
}

// Money or '—' for a missing value (Runtruck1 used '—' for unknown pay/margin).
export function formatMoneyOrDash(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? EM_DASH : formatSignedMoney(cents);
}

// F-K — '$412K': whole thousands.
export function formatMoneyK(cents: number): string {
  return `$${Math.round(cents / 100 / 1000)}K`;
}

// F-K1 — '$91.9K': one decimal, rounded to the hundred first (91,850 → 91.9).
export function formatMoneyK1(cents: number): string {
  return `$${(Math.round(cents / 100 / 100) / 10).toFixed(1)}K`;
}

// F-M1 — '$1.3M'.
export function formatMoneyM1(cents: number): string {
  return `$${(Math.round(cents / 100 / 100_000) / 10).toFixed(1)}M`;
}

// F-RPM — '$5.13' from a rate per mile in cents (the API computes it); '—' when unknown.
export function formatRatePerMile(centsPerMile: number | null | undefined): string {
  return centsPerMile === null || centsPerMile === undefined ? EM_DASH : `$${(centsPerMile / 100).toFixed(2)}`;
}

// F-INT — '1,142', '41,200'.
export function formatInt(n: number): string {
  return n.toLocaleString('en-US');
}

// F-SHORT — 'Sep 3' (no year, no leading zero).
export function formatShortDate(date: string): string {
  const { m, d } = parseIsoDate(date);
  return `${MONTHS[m - 1] ?? ''} ${d}`;
}

// F-DATE — 'Sep 3' within the current (org) year, else 'Mar 14, 2022'.
export function formatDate(date: string, today: string): string {
  const { y } = parseIsoDate(date);
  return y === parseIsoDate(today).y ? formatShortDate(date) : `${formatShortDate(date)}, ${y}`;
}

// F-MONTHYEAR — 'Apr 2028'.
export function formatMonthYear(date: string): string {
  const { y, m } = parseIsoDate(date);
  return `${MONTHS[m - 1] ?? ''} ${y}`;
}

// F-MMYYYY — '04/2028' (Drivers tab CDL column).
export function formatMmYyyy(date: string): string {
  const { y, m } = parseIsoDate(date);
  return `${pad2(m)}/${y}`;
}

// F-AGE — '41 d' days since `from`; '—' when there is no date.
export function formatAge(days: number | null | undefined): string {
  return days === null || days === undefined ? EM_DASH : `${days} d`;
}

// F-HOS — minutes → '6h 20m', '9h 05m'; '—' when unknown.
export function formatHos(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return EM_DASH;
  return `${Math.floor(minutes / 60)}h ${pad2(minutes % 60)}m`;
}

// Wall-clock parts of an instant in an IANA timezone.
export function wallClock(instant: string | Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(typeof instant === 'string' ? new Date(instant) : instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

// F-TODAY-TIME — 'Today 07:12' on the org's business day, otherwise 'Sep 2 14:05'.
export function formatActivityTime(instant: string, timeZone: string, today: string): string {
  const { date, time } = wallClock(instant, timeZone);
  return date === today ? `Today ${time}` : `${formatShortDate(date)} ${time}`;
}

// Human numbers: the API stores integers, the UI shows prefixed strings.
export const formatLoadNumber = (n: number) => `L-${n}`;
export const formatInvoiceNumber = (n: number) => `INV-${n}`;
export const formatBatchNumber = (n: number) => `B-${n}`;
export const formatClaimNumber = (n: number) => `CLM-${n}`;

// 'L-40218' → 40218; null when the text is not a load number.
export function parseLoadNumber(text: string): number | null {
  const match = /^L-(\d{1,9})$/i.exec(text.trim());
  return match?.[1] ? Number(match[1]) : null;
}

// 'Thu' for 2026-09-03 — the weekday of a business date (Dashboard revenue bars).
export function formatWeekdayShort(date: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

export type PayBasis = 'per_mile' | 'percent_of_line_haul' | 'annual_salary' | 'hourly';

// Pay basis label (docs/03-database.md §6.0.6), shared by HR › Contracts and
// Accounting › Payroll so both read identically: '$0.62 / mi', '25% of line haul',
// '$68,000 / yr', '$34.50 / hr'.
export function formatPayBasis(basis: PayBasis, payRateCents: number | null, payPercentBp: number | null): string {
  switch (basis) {
    case 'per_mile':
      return `$${((payRateCents ?? 0) / 100).toFixed(2)} / mi`;
    case 'percent_of_line_haul':
      return `${(payPercentBp ?? 0) / 100}% of line haul`;
    case 'annual_salary':
      return `${formatMoney(payRateCents ?? 0)} / yr`;
    case 'hourly':
      return `$${((payRateCents ?? 0) / 100).toFixed(2)} / hr`;
  }
}
