import { addDaysIso } from '@runtruck/calculations';

// Business windows of the HR and Safety KPIs, derived from the organization's "today"
// (ClockService.today; D4). Dates are YYYY-MM-DD calendar days computed in UTC, never
// through a local Date or the server's own date (docs/api/hr.md §1.1, docs/api/safety.md §1.1).

// The Monday–Sunday org week containing `today`.
export function orgWeek(today: string): { weekStart: string; weekEnd: string } {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const weekStart = addDaysIso(today, -((weekday + 6) % 7));
  return { weekStart, weekEnd: addDaysIso(weekStart, 6) };
}

// The first day of today's calendar quarter (2026-09-03 → 2026-07-01).
export function quarterStart(today: string): string {
  const month = Number(today.slice(5, 7));
  const first = Math.floor((month - 1) / 3) * 3 + 1;
  return `${today.slice(0, 4)}-${String(first).padStart(2, '0')}-01`;
}

// January 1 of today's year: YTD is yearStart … today, inclusive.
export function yearStart(today: string): string {
  return `${today.slice(0, 4)}-01-01`;
}

// Work orders "done · last 30 d": completed on or after today − 30 days.
export function doneWindowStart(today: string): string {
  return addDaysIso(today, -30);
}

// Driver documents "Renew before …": today + 60 days.
export function expiringWindowEnd(today: string): string {
  return addDaysIso(today, 60);
}

// The same month and day one year earlier; Feb 29 becomes Feb 28.
export function oneYearBefore(today: string): string {
  const year = String(Number(today.slice(0, 4)) - 1).padStart(4, '0');
  const monthDay = today.slice(5) === '02-29' ? '02-28' : today.slice(5);
  return `${year}-${monthDay}`;
}

// Violations "Points (12 mo)": occurred after today − 1 year, i.e. on or after the day after.
export function pointsWindowStart(today: string): string {
  return addDaysIso(oneYearBefore(today), 1);
}
