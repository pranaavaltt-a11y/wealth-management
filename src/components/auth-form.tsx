'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/client';
import { ErrorNote } from '@/components/ui';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const isSignup = mode === 'signup';
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setFields({});
    const fd = new FormData(e.currentTarget);
    const payload = Object.fromEntries(fd.entries());
    try {
      await api.post(isSignup ? '/api/auth/signup' : '/api/auth/login', payload);
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFields(err.fields ?? {});
      } else {
        setError('Something went wrong.');
      }
      setPending(false);
    }
  }

  const Err = ({ name }: { name: string }) =>
    fields[name]?.[0] ? <p className="field-error">{fields[name][0]}</p> : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <div className="mb-6">
        <h1 className="tnum text-3xl font-bold text-accent">ArthaTrack</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {isSignup ? 'Create your account.' : 'Net worth, loans and expenses — in one ledger.'}
        </p>
      </div>

      <form onSubmit={onSubmit} className="card space-y-3">
        <ErrorNote message={error} />

        {isSignup && (
          <div>
            <label className="label" htmlFor="name">Full name</label>
            <input id="name" name="name" required minLength={2} className="input" autoComplete="name" />
            <Err name="name" />
          </div>
        )}

        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required className="input" autoComplete="email" />
          <Err name="email" />
        </div>

        <div>
          <label className="label" htmlFor="password">Password</label>
          <input
            id="password" name="password" type="password" required
            minLength={isSignup ? 8 : 1} className="input"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
          />
          <Err name="password" />
        </div>

        {isSignup && (
          <>
            <div>
              <label className="label" htmlFor="panNumber">PAN (optional)</label>
              <input
                id="panNumber" name="panNumber" className="input tnum uppercase"
                placeholder="ABCDE1234F" maxLength={10}
              />
              <Err name="panNumber" />
            </div>
            <div>
              <label className="label" htmlFor="role">Account type</label>
              <select id="role" name="role" className="select" defaultValue="individual">
                <option value="individual">Individual</option>
                <option value="advisor">Advisor / Admin</option>
              </select>
            </div>
          </>
        )}

        <button type="submit" disabled={pending} className="btn btn-primary w-full">
          {pending ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}
        </button>

        <p className="pt-1 text-center text-xs text-fg-muted">
          {isSignup ? 'Already registered? ' : "Don't have an account? "}
          <Link href={isSignup ? '/login' : '/signup'} className="text-accent underline">
            {isSignup ? 'Sign in' : 'Sign up'}
          </Link>
        </p>
      </form>
    </div>
  );
}
