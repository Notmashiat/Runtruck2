import { ALL_PERMISSIONS, type Permission } from './catalog.js';

// Default roles created for every new organization (architecture §13). Roles are
// stored per organization, so a tenant can adjust them later; these are only the
// starting point. Specified in docs/07-roles-permissions.md.

export type RoleKey = 'owner' | 'admin' | 'dispatcher' | 'driver' | 'accounting' | 'manager' | 'maintenance';

export interface RoleDefinition {
  key: RoleKey;
  name: string;
  description: string;
  permissions: readonly Permission[];
}

const views = (...resources: string[]): Permission[] => ALL_PERMISSIONS.filter((p) => resources.some((r) => p === `${r}.view`));

const DISPATCH: Permission[] = [
  'dashboard.view',
  'loads.view',
  'loads.create',
  'loads.update',
  'loads.assign',
  ...views('drivers', 'trucks', 'trailers', 'carriers', 'customers', 'locations', 'documents', 'maintenance', 'compliance'),
  'documents.upload',
  'planner.view',
  'planner.manage',
];

export const DEFAULT_ROLES: readonly RoleDefinition[] = [
  {
    key: 'owner',
    name: 'Owner',
    description: 'Full access, including organization settings and roles.',
    permissions: ALL_PERMISSIONS,
  },
  {
    key: 'admin',
    name: 'Admin',
    description: 'Full operational access; can manage users and roles.',
    permissions: ALL_PERMISSIONS.filter((p) => p !== 'organization.manage'),
  },
  {
    key: 'dispatcher',
    name: 'Dispatcher',
    description: 'Plans, creates and assigns loads.',
    permissions: DISPATCH,
  },
  {
    key: 'driver',
    name: 'Driver',
    description: 'Driver app access to assigned loads (Phase 9).',
    permissions: ['loads.view', 'documents.view', 'documents.upload'],
  },
  {
    key: 'accounting',
    name: 'Accounting',
    description: 'Invoices, payments, bills and settlements.',
    permissions: [
      'dashboard.view',
      ...views('loads', 'customers', 'carriers', 'drivers', 'documents'),
      'billing.view',
      'billing.create',
      'billing.approve',
      'payables.view',
      'payables.create',
      'payables.approve',
      'settlements.view',
      'settlements.create',
      'settlements.approve',
      'planner.view',
    ],
  },
  {
    key: 'manager',
    name: 'Manager',
    description: 'Read access across the business plus approvals.',
    permissions: [
      ...ALL_PERMISSIONS.filter((p) => p.endsWith('.view')),
      'billing.approve',
      'settlements.approve',
      'payables.approve',
      'planner.manage',
    ],
  },
  {
    key: 'maintenance',
    name: 'Maintenance',
    description: 'Fleet upkeep and inspections.',
    permissions: [
      ...views('trucks', 'trailers', 'drivers', 'maintenance'),
      'trucks.update',
      'trailers.update',
      'maintenance.create',
      'maintenance.update',
      'planner.view',
      'planner.manage',
    ],
  },
];

export function roleDefinition(key: RoleKey): RoleDefinition {
  const role = DEFAULT_ROLES.find((r) => r.key === key);
  if (!role) throw new Error(`Unknown role ${key}`);
  return role;
}
