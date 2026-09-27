'use client';

import { useEffect, useRef, useState } from 'react';
import {
  profileIssues, type BusinessProfile, type LinkCheckDTO, type MetaKitDTO,
} from '@aibot/shared';
import { get, put, post, ApiError } from '@/lib/api';
import { Button, Field, Input, TextArea, Select, Stack, Row, Note, Pill } from '@/components/ui';

/**
 * ★★ ملفُّ النشاط وحزمةُ ميتا — مكوّنان يُستعملان في ثلاثة مواضع:
 *   معالجُ العميل الجديد، وورقةُ العميل في لوحة المالك، وشاشةُ القنوات عند العميل.
 *   نسخةٌ واحدةٌ لا ثلاث: حقلٌ يُضاف في موضعٍ ويُنسى في آخر يُنتج صفحاتٍ ناقصة.
 */

const EMPTY: BusinessProfile = {
  tradeAr: '', tradeEn: '', legalAr: '', legalEn: '', cr: '', country: 'الأردن', city: '',
  address: '', addressEn: '', phone: '', email: '', site: '', category: '', description: '', logo: '',
};

const COUNTRIES = ['الأردن', 'السعودية', 'الإمارات', 'فلسطين', 'مصر', 'العراق', 'الكويت', 'قطر', 'البحرين', 'عُمان', 'لبنان', 'سوريا']
  .map((c) => ({ value: c, label: c }));

/** يصغّر الشعارَ في المتصفّح إلى ٥١٢ بكسلاً PNG — فيبقى تحت حدّ الخادم ويصلح أيقونة. */
function shrinkLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('تعذّرت قراءة الصورة'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('الملفّ ليس صورة صالحة'));
      img.onload = () => {
        const side = Math.min(512, Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = side; c.height = side;
        const g = c.getContext('2d')!;
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, side, side);
        const r = Math.min(side / img.width, side / img.height);
        g.drawImage(img, (side - img.width * r) / 2, (side - img.height * r) / 2, img.width * r, img.height * r);
        resolve(c.toDataURL('image/png'));
      };
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  });
}

export function ProfileForm({ initial, endpoint, onSaved, submitLabel = 'احفظ الملفّ' }: {
  initial: Partial<BusinessProfile> | null | undefined;
  /** مسارُ الحفظ (‏PUT) — للعميل أو للوحة المالك. */
  endpoint: string;
  onSaved: (r: { profile: BusinessProfile; kit: MetaKitDTO }) => void;
  submitLabel?: string;
}) {
  const [f, setF] = useState<BusinessProfile>({ ...EMPTY, ...(initial ?? {}) });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof BusinessProfile) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    const issues = profileIssues(f);
    setErrs(issues);
    if (Object.keys(issues).length) { setMsg('راجع الحقول المعلّمة.'); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await put<{ profile: BusinessProfile; kit: MetaKitDTO }>(endpoint, f);
      onSaved(r);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'تعذّر الحفظ.');
    } finally { setBusy(false); }
  }

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    try { setF((x) => ({ ...x, logo: '' })); const d = await shrinkLogo(file); setF((x) => ({ ...x, logo: d })); }
    catch (e) { setErrs((x) => ({ ...x, logo: (e as Error).message })); }
  }

  return (
    <Stack gap="sm">
      <p className="muted-p">
        منه تبنى صفحات العميل العامّة وحزمة ميتا. واكتب الاسم القانونيّ والعنوان كما في السجلّ التجاريّ:
        توثيق النشاط عند ميتا يطابقهما حرفا بحرف.
      </p>
      <div className="bp-grid">
        <Field id="bp-trade-ar" label="الاسم التجاريّ بالعربيّة" error={errs.tradeAr} hint="يظهر في رأس الصفحات.">
          <Input id="bp-trade-ar" value={f.tradeAr} onChange={set('tradeAr')} />
        </Field>
        <Field id="bp-trade-en" label="الاسم التجاريّ بالإنجليزيّة" error={errs.tradeEn} hint="اسم تطبيق ميتا، ويطابق اسم العرض في واتساب.">
          <Input id="bp-trade-en" value={f.tradeEn} dir="ltr" onChange={set('tradeEn')} />
        </Field>
        <Field id="bp-legal-ar" label="الاسم القانونيّ بالعربيّة" error={errs.legalAr}>
          <Input id="bp-legal-ar" value={f.legalAr} onChange={set('legalAr')} />
        </Field>
        <Field id="bp-legal-en" label="الاسم القانونيّ بالإنجليزيّة (اختياريّ)" error={errs.legalEn}>
          <Input id="bp-legal-en" value={f.legalEn} dir="ltr" onChange={set('legalEn')} />
        </Field>
        <Field id="bp-cr" label="رقم السجلّ التجاريّ (اختياريّ)" error={errs.cr}>
          <Input id="bp-cr" value={f.cr} dir="ltr" onChange={set('cr')} />
        </Field>
        <Field id="bp-country" label="الدولة" error={errs.country}>
          <Select id="bp-country" value={f.country} onChange={set('country')}
            options={COUNTRIES.some((c) => c.value === f.country) ? COUNTRIES : [{ value: f.country, label: f.country }, ...COUNTRIES]} />
        </Field>
        <Field id="bp-city" label="المدينة" error={errs.city}>
          <Input id="bp-city" value={f.city} onChange={set('city')} />
        </Field>
        <Field id="bp-phone" label="هاتف الزبائن" error={errs.phone} hint="بصيغة دوليّة، مثل ‎+962 79 000 0000.">
          <Input id="bp-phone" value={f.phone} dir="ltr" onChange={set('phone')} />
        </Field>
        <div className="bp-wide">
          <Field id="bp-address" label="العنوان" error={errs.address}>
            <Input id="bp-address" value={f.address} onChange={set('address')} />
          </Field>
        </div>
        <div className="bp-wide">
          <Field id="bp-address-en" label="العنوان بالإنجليزيّة" error={errs.addressEn} hint="للنسخة الإنجليزيّة التي يقرؤها مراجع ميتا.">
            <Input id="bp-address-en" value={f.addressEn} dir="ltr" onChange={set('addressEn')} />
          </Field>
        </div>
        <Field id="bp-email" label="بريد التواصل" error={errs.email} hint="يظهر في الصفحات، ويوضع في Contact email عند ميتا.">
          <Input id="bp-email" type="email" value={f.email} dir="ltr" onChange={set('email')} />
        </Field>
        <Field id="bp-site" label="الموقع الإلكترونيّ (اختياريّ)" error={errs.site}>
          <Input id="bp-site" value={f.site} dir="ltr" placeholder="https://" onChange={set('site')} />
        </Field>
        <Field id="bp-cat" label="مجال النشاط (اختياريّ)" error={errs.category}>
          <Input id="bp-cat" value={f.category} onChange={set('category')} />
        </Field>
        <div className="bp-wide">
          <Field id="bp-desc" label="وصف قصير (اختياريّ)" error={errs.description}>
            <TextArea id="bp-desc" value={f.description} rows={2} onChange={set('description')} />
          </Field>
        </div>
        <div className="bp-wide">
          <Field id="bp-logo" label="الشعار (اختياريّ)" error={errs.logo}
            hint="بدونه تصنع الأيقونة من أوّل حرف في الاسم. يصغّر إلى 512 بكسلا قبل الحفظ.">
            <input id="bp-logo" type="file" accept="image/png,image/jpeg,image/webp"
              onChange={(e) => void pickLogo(e.target.files?.[0])} />
          </Field>
          {f.logo && (
            <Row gap="sm">
              <img className="bp-logo" src={f.logo} alt="الشعار" />
              <Button size="sm" onClick={() => setF((x) => ({ ...x, logo: '' }))}>أزل الشعار</Button>
            </Row>
          )}
        </div>
      </div>
      {msg && <Note tone="crit">{msg}</Note>}
      <Row gap="sm"><Button variant="primary" busy={busy} onClick={() => void save()}>{submitLabel}</Button></Row>
    </Stack>
  );
}

/* ───────────────────────── الأيقونة ───────────────────────── */

/** يرسم الأيقونة: الشعارُ على أبيض، أو أوّلُ حرفٍ من الاسم على أخضر المنصّة. */
function drawIcon(c: HTMLCanvasElement, name: string, logo: string | undefined, done?: () => void) {
  const g = c.getContext('2d');
  if (!g) return;
  const w = c.width;
  if (logo) {
    const img = new Image();
    img.onload = () => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, w);
      const r = Math.min(w / img.width, w / img.height) * 0.86;
      g.drawImage(img, (w - img.width * r) / 2, (w - img.height * r) / 2, img.width * r, img.height * r);
      done?.();
    };
    img.src = logo;
    return;
  }
  const grad = g.createLinearGradient(0, 0, w, w);
  grad.addColorStop(0, '#0d7457'); grad.addColorStop(1, '#0a4f3c');
  g.fillStyle = grad; g.fillRect(0, 0, w, w);
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `700 ${Math.round(w * 0.46)}px system-ui, "Segoe UI", Tahoma, sans-serif`;
  const ch = (name || '؟').trim().replace(/^ال/, '').charAt(0);
  g.fillText(ch, w / 2, w / 2 + w * 0.03);
  done?.();
}

export function AppIcon({ name, logo }: { name: string; logo?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => { if (ref.current) drawIcon(ref.current, name, logo); }, [name, logo]);

  function download() {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 1024;
    drawIcon(c, name, logo, () => {
      const a = document.createElement('a');
      a.href = c.toDataURL('image/png');
      a.download = 'app-icon-1024.png';
      a.click();
    });
  }

  return (
    <div className="kit-icon">
      <canvas ref={ref} width={256} height={256} aria-label="أيقونة التطبيق" />
      <div>
        <b>أيقونة التطبيق</b>
        <p className="muted-p">مربّعة 1024×1024، من الشعار أو من أوّل حرف في الاسم. بلا أيّ شعار لميتا.</p>
        <Button size="sm" onClick={download}>نزّل الأيقونة</Button>
      </div>
    </div>
  );
}

/* ───────────────────────── حزمة ميتا ───────────────────────── */

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn quiet sm" onClick={() => {
      void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); });
    }}>{done ? 'نسخ' : 'انسخ'}</button>
  );
}

function KitRow({ k, sub, v, ltr = true }: { k: string; sub?: string; v: string | null; ltr?: boolean }) {
  return (
    <div className="kit-r">
      <div className="kit-k">{k}{sub && <small>{sub}</small>}</div>
      <div className={`kit-v${ltr ? ' mono' : ''}`} dir={ltr ? 'ltr' : undefined}>{v ?? '—'}</div>
      {v ? <Copy text={v} /> : <span />}
    </div>
  );
}

const LABEL: Record<string, string> = { profile: 'التعريف', privacy: 'الخصوصيّة', terms: 'الشروط', deletion: 'حذف البيانات' };

export function MetaKitPanel({ kit, checkEndpoint, name, logo, whatsapp = true }: {
  kit: MetaKitDTO;
  checkEndpoint: string;
  name: string;
  logo?: string;
  /** حزمةُ التطبيق لواتساب وحده — إنستجرام على تطبيق المنصّة فلا يُلصق له شيء. */
  whatsapp?: boolean;
}) {
  const [check, setCheck] = useState<LinkCheckDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true); setErr(null);
    try { setCheck(await post<LinkCheckDTO>(checkEndpoint)); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'تعذّر الفحص.'); }
    finally { setBusy(false); }
  }

  return (
    <Stack gap="md">
      {!kit.profileComplete && (
        <Note tone="warn">
          <b>ملفّ النشاط ناقص — فالصفحات العامّة لا تنشر بعد.</b>{' '}
          {Object.values(kit.missing).slice(0, 3).join(' ')}
        </Note>
      )}

      <section className="kit-sec">
        <h3>الصفحات العامّة</h3>
        <div className="kit">
          {(Object.keys(kit.urls) as Array<keyof typeof kit.urls>).map((k) => (
            <div className="kit-r" key={k}>
              <div className="kit-k">{LABEL[k]}</div>
              <div className="kit-v mono" dir="ltr">
                <a href={kit.urls[k]} target="_blank" rel="noopener noreferrer">{kit.urls[k]}</a>
              </div>
              <Copy text={kit.urls[k]} />
            </div>
          ))}
        </div>
        <Row gap="sm">
          <Button busy={busy} onClick={() => void run()} disabled={!kit.profileComplete}
            reason="أكمل ملفّ النشاط أوّلا.">افحص الروابط</Button>
          <span className="muted-p">يفتح كلّ صفحة كما تفتحها ميتا، ويتأكّد أنّها تعمل وتحمل الاسم والبريد.</span>
        </Row>
        {err && <Note tone="crit">{err}</Note>}
        {check && (
          <ul className="kit-chk">
            {check.items.map((i) => {
              const ok = i.status === 200 && i.hasName && i.hasEmail;
              return (
                <li key={i.key}>
                  <Pill tone={ok ? 'ok' : 'crit'} label={ok ? 'سليمة' : 'فيها مشكلة'} />
                  <span>{LABEL[i.key]}: {i.status === 200
                    ? (ok ? 'تعمل وتحمل الاسم والبريد.' : `تعمل لكن ${!i.hasName ? 'بلا الاسم التجاريّ' : 'بلا بريد التواصل'}.`)
                    : `لا تفتح — ${i.error ?? 'بلا ردّ'}.`}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {whatsapp && (
        <>
          <section className="kit-sec">
            <h3>تطبيق العميل عند ميتا ← إعدادات التطبيق ← أساسي</h3>
            <AppIcon name={kit.appSettings.displayName || name} logo={logo} />
            <div className="kit">
              <KitRow k="Display name" sub="اسم التطبيق" v={kit.appSettings.displayName} />
              <KitRow k="Contact email" sub="بريد التواصل" v={kit.appSettings.contactEmail || null} />
              <KitRow k="Privacy policy URL" sub="سياسة الخصوصيّة" v={kit.appSettings.privacyUrl} />
              <KitRow k="Terms of Service URL" sub="الشروط والأحكام" v={kit.appSettings.termsUrl} />
              <KitRow k="User data deletion" sub="اختر Data deletion instructions URL" v={kit.appSettings.dataDeletionUrl} />
              <KitRow k="App domains" sub="دومينات التطبيق" v={kit.appSettings.appDomain} />
              <KitRow k="Category" sub="الفئة المقترحة" v={kit.appSettings.category} />
              <KitRow k="App purpose" sub="الغرض" v={kit.appSettings.purpose} />
            </div>
          </section>

          <section className="kit-sec">
            <h3>واتساب ← الإعداد (WhatsApp → Configuration)</h3>
            <div className="kit">
              <KitRow k="Callback URL" sub="رابط الويبهوك" v={kit.whatsapp.callbackUrl} />
              <KitRow k="Verify token" sub={kit.whatsapp.verifyToken ? 'رمز التحقّق' : 'يظهر بعد ربط القناة'} v={kit.whatsapp.verifyToken} />
              <KitRow k="Webhook field" sub="الحقل الذي يفعّل" v={kit.whatsapp.webhookField} />
            </div>
          </section>

          <section className="kit-sec">
            <h3>ترتيب العمل عند ميتا</h3>
            <ol className="kit-steps">
              <li>إنشاء تطبيق من نوع Business في developers.facebook.com.</li>
              <li>إضافة منتج WhatsApp وربط الرقم.</li>
              <li>لصق حقول «أساسي» أعلاه ورفع الأيقونة، ثمّ تحويل التطبيق إلى Live.</li>
              <li>إنشاء مستخدم نظام وتوكن دائم، وربط القناة في الخطوة التالية.</li>
              <li>لصق Callback URL و Verify token وتفعيل حقل messages.</li>
            </ol>
          </section>
        </>
      )}
    </Stack>
  );
}

/* ───────────────────────── المحرّر الكامل ───────────────────────── */

interface Loaded { slug: string; profile: Partial<BusinessProfile>; kit: MetaKitDTO }

/**
 * ملفّ النشاط وحزمةُ ميتا في موضعٍ واحد — لورقة العميل في اللوحة ولشاشة القنوات.
 * يفتح على الحزمة إن كان الملفّ مكتملاً (الأكثرُ طلباً بعد الإنشاء)، وعلى الملفّ إن نقص.
 */
export function ProfileKitEditor({ loadPath, savePath, checkPath, name, whatsapp = true }: {
  loadPath: string; savePath: string; checkPath: string; name: string; whatsapp?: boolean;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'profile' | 'kit' | null>(null);

  useEffect(() => {
    let live = true;
    setData(null); setErr(null); setTab(null);
    get<Loaded>(loadPath)
      .then((d) => { if (live) { setData(d); setTab(d.kit.profileComplete ? 'kit' : 'profile'); } })
      .catch((e) => { if (live) setErr(e instanceof ApiError ? e.message : 'تعذّر التحميل.'); });
    return () => { live = false; };
  }, [loadPath]);

  if (err) return <Note tone="crit">{err}</Note>;
  if (!data || !tab) return <p className="muted-p">يحمّل…</p>;

  return (
    <Stack gap="md">
      <Row gap="xs">
        <Button variant={tab === 'profile' ? 'primary' : 'quiet'} size="sm" onClick={() => setTab('profile')}>ملفّ النشاط</Button>
        <Button variant={tab === 'kit' ? 'primary' : 'quiet'} size="sm" onClick={() => setTab('kit')}>الصفحات وحزمة ميتا</Button>
      </Row>
      {tab === 'profile'
        ? <ProfileForm initial={data.profile} endpoint={savePath}
            onSaved={(r) => { setData({ ...data, profile: r.profile, kit: r.kit }); setTab('kit'); }} />
        : <MetaKitPanel kit={data.kit} checkEndpoint={checkPath} name={name}
            logo={data.profile.logo || undefined} whatsapp={whatsapp} />}
    </Stack>
  );
}
