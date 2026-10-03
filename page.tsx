'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export default function Login() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function google() {
    setError(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      router.push('/');
    } catch {
      setError('Sign-in failed. Check that this domain is listed under Authorized domains in Firebase.');
    }
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-sm place-content-center gap-4">
      <h1 className="text-xl font-semibold text-slate-50">Sign in</h1>
      <button onClick={google} className="rounded-lg bg-white px-4 py-2 font-medium text-slate-900">Continue with Google</button>
      {error && <p className="text-sm text-rose-300" role="alert">{error}</p>}
    </main>
  );
}
