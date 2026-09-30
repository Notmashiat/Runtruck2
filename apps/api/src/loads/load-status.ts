import { LOAD_STATUS_LABEL } from '@runtruck/calculations';
import type { LoadStatus } from '@runtruck/types';
import type { CreateLoadBody } from '@runtruck/validation';
import { AppError } from '../common/errors/app-error.js';

// The load state machine (docs/08-load-lifecycle.md §3). Every writer that changes a
// load's status calls assertLoadTransition; an illegal move is 409 LOAD_INVALID_TRANSITION.

// Allowed moves (T1–T12). Everything else — leaving `delivered`, going back from
// `needs_pod`, skipping from `needs_driver` to an in-progress status — is refused.
export const LOAD_TRANSITIONS: Readonly<Record<LoadStatus, readonly LoadStatus[]>> = {
  needs_driver: ['dispatched'], // T1
  dispatched: ['needs_driver', 'at_pickup', 'in_transit'], // T2, T3, T5
  at_pickup: ['in_transit', 'delayed'], // T4, T7
  in_transit: ['delayed', 'needs_pod', 'delivered'], // T6, T10, T11
  delayed: ['in_transit', 'needs_pod', 'delivered'], // T8, T9, T11
  needs_pod: ['delivered'], // T12
  delivered: [],
};

export function canTransitionLoad(from: LoadStatus, to: LoadStatus): boolean {
  return LOAD_TRANSITIONS[from].includes(to);
}

export function assertLoadTransition(from: LoadStatus, to: LoadStatus): void {
  if (!canTransitionLoad(from, to)) {
    throw AppError.conflict('LOAD_INVALID_TRANSITION', `This load can't move from ${LOAD_STATUS_LABEL[from]} to ${LOAD_STATUS_LABEL[to]}.`);
  }
}

// Initial status on create (08 §4, Runtruck1 toLoad `covered`): a partner carrier or an
// own-fleet driver puts the load on the board as dispatched (T0b), otherwise needs_driver (T0a).
export function initialLoadStatus(haul: CreateLoadBody['haul']): 'dispatched' | 'needs_driver' {
  const covered = haul.hauledBy === 'partner_carrier' || haul.driverId !== null;
  return covered ? 'dispatched' : 'needs_driver';
}
