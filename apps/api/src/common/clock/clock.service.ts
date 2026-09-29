import { Inject, Injectable } from '@nestjs/common';
import { calendarDateIn } from '@runtruck/calculations';
import type { ApiEnv } from '@runtruck/config';
import { API_ENV } from '../../config/config.module.js';

// The single source of "now" for business logic. In demo environments
// DEMO_TODAY pins the calendar date (Runtruck1 parity: 2026-09-03) while the
// time of day stays real, so records created during a demo read as "today".
// DEMO_TODAY is rejected in production by the env schema.
@Injectable()
export class ClockService {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  // The organization's business date, YYYY-MM-DD.
  today(timeZone: string): string {
    return this.env.DEMO_TODAY ?? calendarDateIn(new Date(), timeZone);
  }

  // The current instant (UTC). With DEMO_TODAY, the pinned date at today's wall-clock time in `timeZone`.
  now(timeZone: string): Date {
    const real = new Date();
    if (!this.env.DEMO_TODAY) return real;
    const shift = Date.parse(`${this.env.DEMO_TODAY}T00:00:00Z`) - Date.parse(`${calendarDateIn(real, timeZone)}T00:00:00Z`);
    return new Date(real.getTime() + shift);
  }
}
