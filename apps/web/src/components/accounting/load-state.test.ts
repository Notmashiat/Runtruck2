import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/client';
import { loadFailure } from './load-state';

// implementation-brief §4 rules 2–4.
describe('loadFailure', () => {
  it('shows nothing while pending or with data (a failed refetch keeps the data)', () => {
    expect(loadFailure(undefined, null)).toBeUndefined();
    expect(loadFailure({ data: [] }, new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong.', 'r1'))).toBeUndefined();
  });

  it('treats a refusal exactly as pending', () => {
    expect(loadFailure(undefined, new ApiError(403, 'FORBIDDEN', 'You do not have permission to do that.', 'r2'))).toBeUndefined();
  });

  it("shows the API's user-safe message for any other failure", () => {
    expect(loadFailure(undefined, new ApiError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', 'r3'))).toBe('Some fields are invalid.');
    expect(loadFailure(undefined, new ApiError(502, 'DEPENDENCY_UNAVAILABLE', 'Try again shortly.', 'r4'))).toBe('Try again shortly.');
    expect(loadFailure(undefined, new TypeError('Failed to fetch'))).toBe('Something went wrong.');
  });
});
