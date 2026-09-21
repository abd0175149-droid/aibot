'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { post, setToken, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

interface LoginResult {
  access: string;
  user: { role: string; mustChangePassword: boolean };
}

function LoginForm() {
  const router = useRouter();
  // useSearchParams تُخرج الصفحة من التوليد الساكن — ولذلك تحتها Suspense
  const params = useSearchParams();
  const { reload } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<LoginResult>('/auth/login', { email, password });
      setToken(r.access);
      await reload();
      const next = params.get('next');
      // مالك المنصّة يبدأ من لوحته، والعميل من لوحته — لا شاشة اختيار
      router.replace(next ?? (r.user.role === 'platform_owner' ? '/console' : '/app'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذّر تسجيل الدخول. حاول ثانيةً.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <h1>AiBot</h1>
      <p className="sub">سجّل الدخول لإدارة بوتك</p>

      {error && <div className="err" role="alert">{error}</div>}

      <label className="field">
        <span>البريد الإلكترونيّ</span>
        <input
          className="input" type="email" name="email" autoComplete="username"
          dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      <label className="field">
        <span>كلمة السرّ</span>
        <input
          className="input" type="password" name="password" autoComplete="current-password"
          required value={password} onChange={(e) => setPassword(e.target.value)}
        />
      </label>

      <button className="btn pri" type="submit" disabled={busy} style={{ width: '100%', padding: 10 }}>
        {busy ? 'جارٍ الدخول…' : 'دخول'}
      </button>

      <p style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 16, marginBottom: 0 }}>
        نسيت كلمة السرّ؟ راسل من أنشأ حسابك — الاستعادة الذاتيّة قادمة.
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="login">
      <Suspense fallback={<div className="skel" style={{ width: 380, height: 300 }} />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
