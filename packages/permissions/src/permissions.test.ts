import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, DEFAULT_ROLES, hasPermissions, isPermission } from './index.js';

describe('permission catalog', () => {
  it('uses <resource>.<action> keys', () => {
    for (const p of ALL_PERMISSIONS) expect(p).toMatch(/^[a-z]+\.[a-z]+$/);
  });

  it('every default role only grants catalog permissions, without duplicates', () => {
    for (const role of DEFAULT_ROLES) {
      for (const p of role.permissions) expect(isPermission(p)).toBe(true);
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
    }
  });

  it('owner has everything; the driver role cannot see money', () => {
    const owner = DEFAULT_ROLES.find((r) => r.key === 'owner');
    const driver = DEFAULT_ROLES.find((r) => r.key === 'driver');
    expect(owner?.permissions).toEqual(ALL_PERMISSIONS);
    expect(driver?.permissions).not.toContain('billing.view');
    expect(driver?.permissions).not.toContain('settlements.view');
  });

  it('hasPermissions requires all of the listed permissions', () => {
    expect(hasPermissions(['loads.view', 'loads.create'], ['loads.view'])).toBe(true);
    expect(hasPermissions(new Set(['loads.view']), ['loads.view', 'loads.create'])).toBe(false);
    expect(hasPermissions([], [])).toBe(true);
  });
});
