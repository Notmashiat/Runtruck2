import { redirect } from 'next/navigation';

export default function SafetyIndex(): never {
  redirect('/app/safety/maintenance');
}
