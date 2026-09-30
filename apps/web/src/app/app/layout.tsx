import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { uninvoicedLoadsQuery } from '@/lib/api/billing';
import { Prefetch } from '@/lib/api/prefetch';
import type { ApiQueryDef } from '@/lib/api/query';
import { getMe, requestPathname } from '@/lib/api/server';
import { AppProviders } from '../providers';

// Everything under /app requires a valid session, checked against the API on
// the server before any HTML is sent. (The API still authorizes every call.)
export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/login');

  // Data the shell itself shows on first paint, hydrated ABOVE the Header:
  // the "Invoice N loads" count on accounting pages (docs/api/billing.md §7.1).
  const pathname = await requestPathname();
  const shellQueries: ApiQueryDef<unknown, object>[] = [];
  if (pathname.startsWith('/app/accounting/') && me.permissions.includes('billing.view')) shellQueries.push(uninvoicedLoadsQuery);

  return (
    <AppProviders me={me}>
      <Prefetch queries={shellQueries}>
        <AppShell>{children}</AppShell>
      </Prefetch>
    </AppProviders>
  );
}
