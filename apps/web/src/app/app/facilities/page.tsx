import { FacilitiesPage } from '@/components/facilities/FacilitiesPage';

// Facilities: Runtruck1's static "coming soon" page. It reads no data, so it makes no API
// call and renders for any signed-in member (docs/api/facilities.md §3, decision FA1).
export default function Facilities() {
  return <FacilitiesPage />;
}
