import type { z } from 'zod';
import { pageQuerySchema } from './common.js';

// Carriers input schemas — specified in docs/api/carriers.md.

// GET /carriers — limit, offset, q.
export const carrierListQuerySchema = pageQuerySchema;

export type CarrierListQuery = z.output<typeof carrierListQuerySchema>;
