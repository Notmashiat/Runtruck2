import { ComingSoon } from '@runtruck/ui';

// Facilities, ported verbatim from Runtruck1 pages/app/FacilitiesPage.tsx
// (docs/reference/runtruck1/core-pages.md §6): static copy, no data and no API call
// (docs/api/facilities.md §3, decision FA1). The top-bar search filters nothing here (B14).
export function FacilitiesPage() {
  return (
    <ComingSoon
      title="Every yard, shop and dock in one register"
      body="Where equipment is parked, where loads pick up and deliver, and what each site needs from the driver when they arrive."
      items={[
        'Yards and terminals: what is parked where, and for how long',
        'Shop bays with service scheduling and parts on order',
        'Customer pickup and delivery sites with hours, dock notes and contacts',
        'Fuel, scale and parking stops on frequent lanes',
      ]}
      figure="Yard map"
    />
  );
}
