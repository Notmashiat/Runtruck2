import { z } from 'zod';
import { pageQuerySchema } from './common.js';

// Safety & compliance input schemas — specified in docs/api/safety.md. Every endpoint
// is a read; the organization always comes from the session, so no schema accepts an
// organization id. Unknown query keys are ignored (pageQuerySchema is not strict).

// docs/03-database.md §4.6 (stored lifecycle statuses).
export const workOrderStatusSchema = z.enum(['scheduled', 'due', 'overdue', 'in_shop', 'done']);
export const driverDocumentStatusSchema = z.enum(['valid', 'expiring', 'expired', 'missing']);
export const violationStatusSchema = z.enum(['open', 'contested', 'closed']);
export const claimStatusSchema = z.enum(['open', 'under_review', 'settled', 'denied']);

// GET /work-orders — limit/offset/q, plus an optional single status.
export const listWorkOrdersQuerySchema = pageQuerySchema.extend({
  status: workOrderStatusSchema.optional(),
});

export type ListWorkOrdersQuery = z.output<typeof listWorkOrdersQuerySchema>;

// GET /driver-documents — limit/offset/q, plus an optional single status.
export const listDriverDocumentsQuerySchema = pageQuerySchema.extend({
  status: driverDocumentStatusSchema.optional(),
});

export type ListDriverDocumentsQuery = z.output<typeof listDriverDocumentsQuerySchema>;

// GET /compliance-reminders — limit/offset/q only.
export const listComplianceRemindersQuerySchema = pageQuerySchema;

export type ListComplianceRemindersQuery = z.output<typeof listComplianceRemindersQuerySchema>;

// GET /violations — limit/offset/q, plus an optional single status.
export const listViolationsQuerySchema = pageQuerySchema.extend({
  status: violationStatusSchema.optional(),
});

export type ListViolationsQuery = z.output<typeof listViolationsQuerySchema>;

// GET /claims — limit/offset/q, plus an optional single status.
export const listClaimsQuerySchema = pageQuerySchema.extend({
  status: claimStatusSchema.optional(),
});

export type ListClaimsQuery = z.output<typeof listClaimsQuerySchema>;
