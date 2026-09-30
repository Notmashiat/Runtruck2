import { z } from 'zod';

// Dashboard input schemas, specified in docs/api/dashboard.md.

// GET /api/v1/dashboard takes no query parameters. The figures ignore search text
// (the web filters the table locally), so an unknown key such as `q` is rejected
// with VALIDATION_ERROR instead of being silently ignored.
export const dashboardQuerySchema = z.strictObject({});

export type DashboardQuery = z.output<typeof dashboardQuerySchema>;
