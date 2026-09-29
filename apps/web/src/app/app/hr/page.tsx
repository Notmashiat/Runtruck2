import { redirect } from 'next/navigation';

export default function HrIndex(): never {
  redirect('/app/hr/employee-contracts');
}
