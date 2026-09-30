// The permission catalog (architecture §13). Keys are `<resource>.<action>`.
// Seeded into the `permissions` table; the API's PermissionsGuard checks them.
// Specified in docs/07-roles-permissions.md — change both together.

export const PERMISSIONS = {
  // Organization & access
  'organization.view': 'View organization profile and settings',
  'organization.manage': 'Change organization settings',
  'users.view': 'View users and their roles',
  'users.manage': 'Invite, suspend and assign roles to users',
  'roles.manage': 'Create and edit roles and their permissions',
  'audit.view': 'Read the audit log',

  // Reporting
  'dashboard.view': 'View the operations dashboard',

  // Loads & dispatch
  'loads.view': 'View loads, stops and load activity',
  'loads.create': 'Create loads',
  'loads.update': 'Edit loads and change load status',
  'loads.delete': 'Delete draft loads',
  'loads.assign': 'Assign drivers, trucks, trailers and carriers to loads',

  // Fleet
  'drivers.view': 'View drivers',
  'drivers.create': 'Add drivers',
  'drivers.update': 'Edit drivers',
  'trucks.view': 'View trucks',
  'trucks.create': 'Add trucks',
  'trucks.update': 'Edit trucks',
  'trailers.view': 'View trailers',
  'trailers.create': 'Add trailers',
  'trailers.update': 'Edit trailers',
  'carriers.view': 'View partner carriers',
  'carriers.create': 'Add partner carriers',
  'carriers.update': 'Edit partner carriers',

  // Customers & locations
  'customers.view': 'View customers and contacts',
  'customers.create': 'Add customers',
  'customers.update': 'Edit customers',
  'locations.view': 'View facilities and locations',
  'locations.create': 'Add facilities',
  'locations.update': 'Edit facilities',

  // Documents
  'documents.view': 'View and download load documents',
  'documents.upload': 'Upload load documents',

  // Billing (receivables)
  'billing.view': 'View invoices, batches and payments',
  'billing.create': 'Create invoices and invoice batches',
  'billing.approve': 'Approve and send invoices, record payments',

  // Payables
  'payables.view': 'View vendor bills',
  'payables.create': 'Enter vendor bills',
  'payables.approve': 'Approve and pay vendor bills',

  // Settlements (driver / carrier pay)
  'settlements.view': 'View driver and carrier settlements',
  'settlements.create': 'Prepare settlements',
  'settlements.approve': 'Approve settlements for payment',

  // Safety & compliance
  'maintenance.view': 'View maintenance work orders',
  'maintenance.create': 'Log maintenance work orders',
  'maintenance.update': 'Update maintenance work orders',
  'compliance.view': 'View driver qualification documents and violations',
  'compliance.create': 'Record driver documents and violations',
  'compliance.update': 'Update driver documents and violations',
  'claims.view': 'View cargo and liability claims',
  'claims.create': 'Open claims',
  'claims.update': 'Update and settle claims',

  // HR
  'hr.view': 'View employee contracts and onboarding',
  'hr.create': 'Create contracts and start onboarding',
  'hr.update': 'Update contracts and onboarding',

  // Planner (shared office calendar)
  'planner.view': 'View the planner calendar',
  'planner.manage': 'Create, edit and delete planner events',
  'planner.configure': "Edit the organization's planner color codes",
  'planner.reset': "Restore the organization's default planner events and color codes",
} as const satisfies Record<string, string>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}
