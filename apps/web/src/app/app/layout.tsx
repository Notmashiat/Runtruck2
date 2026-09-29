import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { getMe } from '@/lib/api/server';
import { AppProviders } from '../providers';

// Everything under /app requires a valid session, checked against the API on
// the server before any HTML is sent. (The API still authorizes every call.)
export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/login');

  return (
    <AppProviders me={me}>
      <AppShell>{children}</AppShell>
    </AppProviders>
  );
}
