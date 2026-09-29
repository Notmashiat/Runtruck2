import { redirect } from 'next/navigation';

export default function FleetIndex(): never {
  redirect('/app/fleet/drivers');
}
