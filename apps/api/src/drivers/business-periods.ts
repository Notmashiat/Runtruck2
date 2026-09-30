import { addDaysIso } from '@runtruck/calculations';

// Business windows derived from the organization's "today" (ClockService.today; D4).
// Dates are YYYY-MM-DD calendar days; nothing here reads the server clock.

// The Monday–Sunday week containing `today` (docs/api/fleet.md §1.1).
export function orgWeek(today: string): { weekStart: string; weekEnd: string } {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const weekStart = addDaysIso(today, -((weekday + 6) % 7));
  return { weekStart, weekEnd: addDaysIso(weekStart, 6) };
}

// January 1 of today's year: YTD is yearStart … today, inclusive.
export function yearStart(today: string): string {
  return `${today.slice(0, 4)}-01-01`;
}
