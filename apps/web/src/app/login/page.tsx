import { redirect } from 'next/navigation';
import { getMe } from '@/lib/api/server';
import { LoginForm } from './LoginForm';

// Sign-in (docs/01-product-requirements.md D2). Runtruck1 had no login; this
// screen reuses the app shell's own tokens and classes so it reads as part of it.
export default async function LoginPage() {
  if (await getMe()) redirect('/app/dashboard');
  return (
    <main className="rt-login">
      <section className="ui-card rt-login-card" aria-labelledby="login-title">
        <div className="ui-card-body">
          <div className="ui-brand rt-login-brand">
            <span className="ui-brand-mark" />
            RunTruck
          </div>
          <h1 id="login-title" className="ui-h2 rt-login-title">
            Sign in
          </h1>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
