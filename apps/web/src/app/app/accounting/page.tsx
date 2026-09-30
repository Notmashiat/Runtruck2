import { redirect } from 'next/navigation';
import { sectionRedirectTarget } from '@/lib/typed-path';

// Runtruck1's index route: the first tab, under the URL as typed ('/app/accounting' in any case).
export default async function AccountingIndex(): Promise<never> {
  redirect(await sectionRedirectTarget('/app/accounting', '/app/accounting/uninvoiced'));
}
