export { ALL_PERMISSIONS, isPermission, PERMISSIONS } from './catalog.js';
export type { Permission } from './catalog.js';
export { DEFAULT_ROLES, roleDefinition } from './roles.js';
export type { RoleDefinition, RoleKey } from './roles.js';

// True when every required permission is granted. Used by the API guard (the
// authority) and by the web app only to hide controls the API would refuse.
export function hasPermissions(granted: ReadonlySet<string> | readonly string[], required: readonly string[]): boolean {
  const set = granted instanceof Set ? granted : new Set(granted);
  return required.every((p) => set.has(p));
}
