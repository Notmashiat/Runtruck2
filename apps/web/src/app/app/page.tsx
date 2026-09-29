import { redirect } from 'next/navigation';
import { getMe } from '@/lib/api/server';
import { homePath } from '@/lib/nav';

export default async function AppIndex(): Promise<never> {
  const me = await getMe();
  redirect(me ? homePath(me.permissions) : '/login');
}
