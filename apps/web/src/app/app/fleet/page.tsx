import { redirect } from 'next/navigation';
import { sectionRedirectTarget } from '@/lib/typed-path';

// Runtruck1's index route: the first tab, under the URL as typed ('/app/fleet' in any case).
export default async function FleetIndex(): Promise<never> {
  redirect(await sectionRedirectTarget('/app/fleet', '/app/fleet/drivers'));
}
