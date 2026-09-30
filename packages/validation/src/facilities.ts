import type { z } from 'zod';
import { pageQuerySchema } from './common.js';

// Facilities input schemas — specified in docs/api/facilities.md.

// GET /facilities — limit, offset, q.
export const facilityListQuerySchema = pageQuerySchema;

export type FacilityListQuery = z.output<typeof facilityListQuerySchema>;
