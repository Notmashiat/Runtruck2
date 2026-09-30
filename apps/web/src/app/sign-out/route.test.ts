import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { GET, POST } from './route';

// The web origin's "sign out of this browser only" fallback (docs/01 C78): it expires the
// httpOnly session cookie, for same-origin requests only.

const post = (headers: Record<string, string>, url = 'http://localhost:3000/sign-out') =>
  POST(new NextRequest(url, { method: 'POST', headers }));

describe('POST /sign-out', () => {
  it('expires the session cookie with the attributes the API set it with', () => {
    const res = post({ 'sec-fetch-site': 'same-origin', origin: 'http://localhost:3000', host: 'localhost:3000' });
    expect(res.status).toBe(204);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^rt_session=;/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=0/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).not.toMatch(/Secure/i);
    // What the browser cached while signed in goes too, as on POST /auth/logout.
    expect(res.headers.get('clear-site-data')).toBe('"cache"');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('marks the expired cookie Secure behind HTTPS', () => {
    const res = post({ 'sec-fetch-site': 'same-origin' }, 'https://app.example.test/sign-out');
    expect(res.headers.get('set-cookie')).toMatch(/Secure/i);
  });

  it('refuses cross-site requests', () => {
    const crossSite: Record<string, string>[] = [
      { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
      { 'sec-fetch-site': 'none' },
      { 'sec-fetch-site': 'same-site', origin: 'http://localhost:5173' },
      { origin: 'http://localhost:5173', host: 'localhost:3000' },
      { origin: 'not a url', host: 'localhost:3000' },
    ];
    for (const headers of crossSite) {
      const res = post(headers);
      expect(res.status, JSON.stringify(headers)).toBe(403);
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(res.headers.get('clear-site-data')).toBeNull();
    }
  });

  it('accepts a same-origin request from a browser without Sec-Fetch-Site', () => {
    expect(post({ origin: 'http://localhost:3000', host: 'localhost:3000' }).status).toBe(204);
  });
});

describe('GET /sign-out', () => {
  it('goes to the landing page, like any unknown path', () => {
    const res = GET();
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/');
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
