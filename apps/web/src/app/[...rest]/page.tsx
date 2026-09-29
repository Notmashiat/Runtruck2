import { redirect } from 'next/navigation';

// Runtruck1 sent every unknown path to the landing page (App.tsx `path="*"`).
export default function UnknownPath(): never {
  redirect('/');
}
