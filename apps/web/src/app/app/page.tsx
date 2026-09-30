import { redirect } from 'next/navigation';
import { getMe } from '@/lib/api/server';
import { homePath } from '@/lib/nav';
import { sectionRedirectTarget } from '@/lib/typed-path';

// Runtruck1's '/app' index route, under the URL as typed ('/APP' → '/APP/dashboard').
export default async function AppIndex(): Promise<never> {
  const me = await getMe();
  redirect(me ? await sectionRedirectTarget('/app', homePath(me.permissions)) : '/login');
}
