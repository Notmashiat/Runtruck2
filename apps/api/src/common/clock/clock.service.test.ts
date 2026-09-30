import type { ApiEnv } from '@runtruck/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClockService } from './clock.service.js';

const clockWith = (demoToday?: string) => new ClockService({ DEMO_TODAY: demoToday } as ApiEnv);

describe('ClockService', () => {
  afterEach(() => vi.useRealTimers());

  it('uses the organization-local date without DEMO_TODAY', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T05:00:00Z')); // still Sep 29 in Los Angeles
    expect(clockWith().today('America/Los_Angeles')).toBe('2026-09-29');
    expect(clockWith().today('UTC')).toBe('2026-09-30');
  });

  it('pins the date but keeps the time of day with DEMO_TODAY', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T21:05:00Z')); // 14:05 in Los Angeles
    const clock = clockWith('2026-09-03');
    expect(clock.today('America/Los_Angeles')).toBe('2026-09-03');
    expect(clock.now('America/Los_Angeles').toISOString()).toBe('2026-09-03T21:05:00.000Z');
  });
});
