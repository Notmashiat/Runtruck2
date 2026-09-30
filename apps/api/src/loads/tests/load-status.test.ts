import { LOAD_STATUSES } from '@runtruck/validation';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../common/errors/app-error.js';
import { assertLoadTransition, canTransitionLoad, initialLoadStatus } from '../load-status.js';

// docs/08-load-lifecycle.md §3: every pair of statuses.
const ALLOWED = new Set([
  'needs_driver>dispatched', // T1
  'dispatched>needs_driver', // T2
  'dispatched>at_pickup', // T3
  'at_pickup>in_transit', // T4
  'dispatched>in_transit', // T5
  'in_transit>delayed', // T6
  'at_pickup>delayed', // T7
  'delayed>in_transit', // T8
  'delayed>needs_pod', // T9
  'in_transit>needs_pod', // T10
  'in_transit>delivered', // T11
  'delayed>delivered', // T11
  'needs_pod>delivered', // T12
]);

describe('assertLoadTransition', () => {
  for (const from of LOAD_STATUSES) {
    for (const to of LOAD_STATUSES) {
      const allowed = ALLOWED.has(`${from}>${to}`);
      it(`${from} → ${to} is ${allowed ? 'allowed' : 'refused'}`, () => {
        expect(canTransitionLoad(from, to)).toBe(allowed);
        if (allowed) {
          expect(() => {
            assertLoadTransition(from, to);
          }).not.toThrow();
        } else {
          try {
            assertLoadTransition(from, to);
            expect.unreachable();
          } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).status).toBe(409);
            expect((err as AppError).code).toBe('LOAD_INVALID_TRANSITION');
          }
        }
      });
    }
  }

  it('names the labels in the message', () => {
    expect(() => {
      assertLoadTransition('delivered', 'needs_pod');
    }).toThrow("This load can't move from Delivered to Needs POD.");
  });
});

describe('initialLoadStatus (08 §4)', () => {
  it('own fleet with a driver or a partner carrier is dispatched, otherwise needs_driver', () => {
    const own = { hauledBy: 'own_fleet' as const, driverId: null, truckId: null, trailerId: null, driverPayCents: null };
    expect(initialLoadStatus(own)).toBe('needs_driver');
    expect(initialLoadStatus({ ...own, truckId: 't', trailerId: 'r' })).toBe('needs_driver');
    expect(initialLoadStatus({ ...own, driverId: 'd' })).toBe('dispatched');
    expect(
      initialLoadStatus({
        hauledBy: 'partner_carrier',
        carrierId: 'c',
        carrierRateCents: 1,
        carrierContactName: null,
        carrierPhone: null,
        driverName: null,
        truckNumber: null,
        trailerNumber: null,
      }),
    ).toBe('dispatched');
  });
});
