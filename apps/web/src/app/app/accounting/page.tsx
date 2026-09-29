import { redirect } from 'next/navigation';

export default function AccountingIndex(): never {
  redirect('/app/accounting/uninvoiced');
}
