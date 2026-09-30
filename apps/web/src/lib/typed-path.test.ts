import { describe, expect, it } from 'vitest';
import { underTypedPath } from './typed-path';

// Runtruck1's index routes resolved their first tab relative to the URL as typed.
describe('underTypedPath', () => {
  it('keeps the typed case of a section root', () => {
    expect(underTypedPath('/app/Fleet', '/app/fleet', '/app/fleet/drivers')).toBe('/app/Fleet/drivers');
    expect(underTypedPath('/App/Accounting', '/app/accounting', '/app/accounting/uninvoiced')).toBe('/App/Accounting/uninvoiced');
    expect(underTypedPath('/APP', '/app', '/app/dashboard')).toBe('/APP/dashboard');
  });

  it('drops a trailing slash, as react-router did', () => {
    expect(underTypedPath('/app/fleet/', '/app/fleet', '/app/fleet/drivers')).toBe('/app/fleet/drivers');
    expect(underTypedPath('/app/', '/app', '/app/dashboard')).toBe('/app/dashboard');
  });

  it('falls back to the canonical target for anything else', () => {
    expect(underTypedPath('', '/app/fleet', '/app/fleet/drivers')).toBe('/app/fleet/drivers');
    expect(underTypedPath('//evil.example', '/app/fleet', '/app/fleet/drivers')).toBe('/app/fleet/drivers');
    expect(underTypedPath('/app/fleetx', '/app/fleet', '/app/fleet/drivers')).toBe('/app/fleet/drivers');
    expect(underTypedPath('/APP', '/app', '/login')).toBe('/login');
  });
});
