import { z } from 'zod';
import { businessDateSchema, pageQuerySchema } from './common.js';

// Settlements (driver payroll) input schemas — specified in docs/api/settlements.md.

export const settlementStatusSchema = z.enum(['ready', 'approved', 'on_hold', 'paid']);

// A real calendar date (rejects 2026-02-30 and year 0), YYYY-MM-DD (common.ts).
const periodStartSchema = businessDateSchema;

// GET /settlements?periodStart=YYYY-MM-DD — without periodStart the API picks the
// period containing today, else the latest one that started on or before today.
export const listSettlementsQuerySchema = pageQuerySchema.extend({
  periodStart: periodStartSchema.optional(),
});

export type ListSettlementsQuery = z.output<typeof listSettlementsQuerySchema>;

// POST /settlements/approve — moves every ready settlement of the period to approved.
// Strict: the organization and the approver come from the session, never the body.
export const approveSettlementsSchema = z.strictObject({
  periodStart: periodStartSchema,
});

export type ApproveSettlementsInput = z.output<typeof approveSettlementsSchema>;
