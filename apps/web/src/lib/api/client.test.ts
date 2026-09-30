import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './client';

// Tenant data never enters the browser's HTTP cache, where it would outlive sign-out.
describe('api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('bypasses the browser HTTP cache on every method', async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(Response.json({ data: null, meta: {} })));
    vi.stubGlobal('fetch', fetchMock);
    const form = new FormData();
    await api.get('/me');
    await api.post('/auth/logout');
    await api.patch('/loads/1', {});
    await api.put('/loads/1', {});
    await api.delete('/loads/1');
    await api.upload('/loads/1/documents', form);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toMatch(/^\/api\/v1\//);
      expect(init.cache, `${init.method ?? ''} ${url}`).toBe('no-store');
      expect(init.credentials).toBe('same-origin');
    }
  });
});
