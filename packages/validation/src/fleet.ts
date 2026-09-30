import { z } from 'zod';
import { pageQuerySchema } from './common.js';

// Fleet input schemas — specified in docs/api/fleet.md.

/** `driver_duty_status` (docs/03-database.md §4.3). */
export const driverDutyStatusSchema = z.enum(['on_duty', 'available', 'home_time']);

// GET /drivers — limit, offset, q, and the roster pill filter.
export const driverListQuerySchema = pageQuerySchema.extend({
  dutyStatus: driverDutyStatusSchema.optional(),
});

export type DriverListQuery = z.output<typeof driverListQuerySchema>;

// GET /trucks — limit, offset, q.
export const truckListQuerySchema = pageQuerySchema;

export type TruckListQuery = z.output<typeof truckListQuerySchema>;

// GET /trailers — limit, offset, q.
export const trailerListQuerySchema = pageQuerySchema;

export type TrailerListQuery = z.output<typeof trailerListQuerySchema>;
