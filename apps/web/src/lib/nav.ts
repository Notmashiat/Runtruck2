import type { Permission } from '@runtruck/permissions';

// Static navigation config (Runtruck1 data/mock.ts NAV + SECTION_TABS). UI
// configuration, not business data. `permission` hides a section from members
// who could not load it anyway; the API still enforces access.

export type ViewKey = 'dashboard' | 'loads' | 'planner' | 'fleet' | 'crm' | 'facilities' | 'accounting' | 'hr' | 'safety';

export interface NavLinkItem {
  key: ViewKey;
  label: string;
  permission: Permission;
}

export const NAV: NavLinkItem[] = [
  { key: 'dashboard', label: 'Dashboard', permission: 'dashboard.view' },
  { key: 'loads', label: 'Loads', permission: 'loads.view' },
  { key: 'planner', label: 'Planner', permission: 'planner.view' },
  { key: 'fleet', label: 'Fleet', permission: 'drivers.view' },
  { key: 'crm', label: 'CRM', permission: 'customers.view' },
  { key: 'facilities', label: 'Facilities', permission: 'locations.view' },
  { key: 'accounting', label: 'Accounting', permission: 'billing.view' },
  { key: 'hr', label: 'HR', permission: 'hr.view' },
  { key: 'safety', label: 'Safety', permission: 'maintenance.view' },
];

export interface SectionTab {
  key: string;
  label: string;
}

// Sections split into tabs; each tab is a route under /app/<section>/<key>.
export const SECTION_TABS: Partial<Record<ViewKey, SectionTab[]>> = {
  fleet: [
    { key: 'drivers', label: 'Drivers' },
    { key: 'trucks', label: 'Trucks' },
    { key: 'trailers', label: 'Trailers' },
  ],
  accounting: [
    { key: 'uninvoiced', label: 'Uninvoiced' },
    { key: 'invoiced', label: 'Invoiced' },
    { key: 'batches', label: 'Batches' },
    { key: 'past-due', label: 'Past Due' },
    { key: 'paid', label: 'Paid' },
    { key: 'payroll', label: 'Payroll' },
    { key: 'bills', label: 'Bills' },
  ],
  hr: [
    { key: 'employee-contracts', label: 'Employee Contracts' },
    { key: 'onboarding', label: 'Onboarding' },
  ],
  safety: [
    { key: 'maintenance', label: 'Maintenance' },
    { key: 'driver-documents', label: 'Driver Documents' },
    { key: 'violations', label: 'Violations' },
    { key: 'settlements', label: 'Settlements' },
  ],
};

// Where a member lands after signing in: the first section they may open
// (the dashboard for anyone with dashboard.view — Runtruck1's landing page).
export function homePath(permissions: readonly string[]): string {
  const first = NAV.find((n) => permissions.includes(n.permission));
  return first ? `/app/${first.key}` : '/app/dashboard';
}

// '/app/fleet/drivers' → { view: 'fleet', tab: 'drivers' }. Route matching is
// case-insensitive in Runtruck1, so normalise first.
export function parseAppPath(pathname: string): { view: ViewKey; segments: string[] } {
  const segments = pathname.toLowerCase().split('/');
  return { view: (segments[2] ?? 'dashboard') as ViewKey, segments };
}
