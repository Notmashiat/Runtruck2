import { redirect } from 'next/navigation';
import { sectionRedirectTarget } from '@/lib/typed-path';

// Runtruck1's index route: the first tab, under the URL as typed ('/app/hr' in any case).
export default async function HrIndex(): Promise<never> {
  redirect(await sectionRedirectTarget('/app/hr', '/app/hr/employee-contracts'));
}
