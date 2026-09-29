'use client';

import { loginSchema } from '@runtruck/validation';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api/client';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    // Same schema the API enforces; checked here only to save a round trip.
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check your email and password.');
      return;
    }
    setPending(true);
    try {
      await api.post('/auth/login', parsed.data);
      router.replace('/app/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach Runtruck. Try again.');
      setPending(false);
    }
  }

  return (
    <form className="rt-login-form" onSubmit={submit} noValidate>
      <label className="ui-field">
        <span className="ui-field-label">Email</span>
        <input
          className="ui-input"
          type="email"
          name="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />
      </label>
      <label className="ui-field">
        <span className="ui-field-label">Password</span>
        <input
          className="ui-input"
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {error && (
        <div className="ui-field-error" role="alert">
          {error}
        </div>
      )}
      <button type="submit" className="ui-btn ui-btn-primary rt-login-submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
