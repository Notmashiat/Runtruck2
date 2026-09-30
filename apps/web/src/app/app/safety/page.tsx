import { redirect } from 'next/navigation';
import { sectionRedirectTarget } from '@/lib/typed-path';

// Runtruck1's index route: the first tab, under the URL as typed ('/app/safety' in any case).
export default async function SafetyIndex(): Promise<never> {
  redirect(await sectionRedirectTarget('/app/safety', '/app/safety/maintenance'));
}
