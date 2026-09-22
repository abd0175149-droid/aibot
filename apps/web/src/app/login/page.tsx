'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { post, setToken, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { safeNext } from '@/lib/nav';
import { Button, Field, Input, Note, Skeleton, Stack } from '@/components/ui';

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

      /* ★ كلمة السرّ المؤقّتة: الخادم يرسل `mustChangePassword` منذ البداية
         ولم يكن يُقرأ إطلاقاً — فمن أُنشئ له حسابٌ بكلمةٍ مؤقّتة يدخل بها
         ويبقى عليها إلى الأبد. وهي كلمةٌ عرفها من أنشأ الحساب. */
      if (r.user.mustChangePassword) {
        router.replace('/app/password?first=1');
        return;
      }

      const next = safeNext(params.get('next'));
      // مالك المنصّة يبدأ من لوحته، والعميل من لوحته — لا شاشة اختيار
      router.replace(next ?? (r.user.role === 'platform_owner' ? '/console' : '/app'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذّر تسجيل الدخول. حاول ثانيةً.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <Stack gap="md">
        <div>
          <h1>AiBot</h1>
          <p className="sub">سجّل الدخول لإدارة بوتك</p>
        </div>

        {error && <Note tone="crit">{error}</Note>}

        <Field id="lg-email" label="البريد الإلكترونيّ">
          <Input id="lg-email" type="email" value={email} onChange={setEmail} dir="ltr" required />
        </Field>

        <Field id="lg-pass" label="كلمة السرّ">
          <Input id="lg-pass" type="password" value={password} onChange={setPassword} required />
        </Field>

        <Button type="submit" variant="primary" busy={busy}>دخول</Button>

        <p className="muted-p">
          نسيت كلمة السرّ؟ راسل من أنشأ حسابك — الاستعادة الذاتيّة قادمة.
        </p>
      </Stack>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="login">
      <Suspense fallback={<Skeleton rows={5} />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
