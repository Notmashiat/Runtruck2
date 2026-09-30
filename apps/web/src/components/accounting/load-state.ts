import { ApiError } from '@/lib/api/client';

// The one loading / refusal / error rule of every ported page (implementation-brief §4,
// 01 C65). Pending and refused (403) reads render the page structure with no rows, KPI
// values "—" and no empty-state line; any other failure adds one `ui-empty` line with
// the API's user-safe message. A failed refetch keeps the previous data on screen.
export function loadFailure(data: unknown, error: unknown): string | undefined {
  if (data !== undefined || !error) return undefined;
  if (error instanceof ApiError) return error.status === 403 ? undefined : error.message;
  return 'Something went wrong.';
}
