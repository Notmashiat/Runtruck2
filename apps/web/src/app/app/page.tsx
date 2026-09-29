import { redirect } from 'next/navigation';

export default function AppIndex(): never {
  redirect('/app/dashboard');
}
