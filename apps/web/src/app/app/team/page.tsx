'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { useApi, useToast, fmt } from '@/lib/useApi';
import { post, patch, download, ApiError } from '@/lib/api';
import { useSession, useCan } from '@/lib/session';
import { readTeam, daysSince, type TeamRole } from '@/lib/team';
import { auditLabel, auditActor, auditKnown, type AuditRow } from '@/lib/audit';
import {
  PageHead, Stack, Row, Pill, Tag, Note, Alert, Meter, Button, Sheet, Table, Empty,
  Skeleton, ErrorBox, KV, KVRow, Field, FormInput, Select, Toggle, CodeBlock,
  type Column,
} from '@/components/ui';
import { Band, Hero, Section, Rows, MetricRow, Fold, ScreenDock, ChipRow, type Sev } from '@/components/screen';

/**
 * الفريق والدعوات.
 *
 * ★ **لماذا توجد هذه الشاشة.** الدوران موجودان في المخطّط منذ أوّل يوم
 *   (`tenant_owner` · `tenant_agent`) و**لا طريقةَ لإنشاء موظّفٍ من الواجهة
 *   إطلاقاً**. فصاحبُ المطعم الذي يحتاج من يردّ على الإنبوكس يفعل الشيء
 *   الوحيد المتاح له: **يعطي موظّفَه كلمةَ مروره**. وهذا ليس احتمالاً
 *   نظريّاً بل ما يحدث فعلاً حين لا يُعطى بديل. وعاقبتُه شيئان لا يُسترجعان:
 *   لا سجلَّ لمن فعل ماذا (كلُّ سطرٍ في `audit_log` باسم المالك)، ولا خروجَ
 *   لموظّفٍ ترك العمل إلّا بتغيير كلمة المالك نفسِه.
 *
 * ── ماذا يُنظَّم هنا وبأيّ ترتيب ─────────────────────────────────────────────
 *
 * ★ **البطوليُّ يُختار بالحالة لا بالتفضيل**، وسؤالُه واحد: «من يستطيع الدخول
 *   إلى حسابي الآن، ومن منهم لا يستعمله؟» فالرقمُ الطبيعيُّ لشاشةِ فريقٍ
 *   («عددُ الأعضاء») خبرٌ لا يُتّخذ عليه قرار — يعرفه صاحبُ النشاط قبل أن
 *   يفتح الشاشة. والرقمُ الذي **لا** يعرفه هو عددُ الحسابات النشطة التي لا
 *   أحدَ يستعملها: بابٌ مفتوحٌ يقرأ محادثات زبائنه ولا يلاحظه أحد. فحين
 *   يوجد هذا الرقم فهو البطوليّ، وحين لا يوجد فالبطوليُّ هو «من يستطيع
 *   الدخول» على خطِّ أساس مقاعد باقته.
 *
 * ★ **وسلّمُ الانتباه واحدٌ لا ثلاثة.** الشريطُ الحاكم والبطوليُّ ورقاقاتُ
 *   الترشيح كلُّها تقرأ `readTeam` من `lib/team` — رتبةً واحدةً (`focus`)
 *   ومجموعاتٍ واحدةً. وكان الشرطُ نفسُه (`>= staleDays`) مكتوباً ثلاث مرّاتٍ
 *   في هذا الملفّ، وهي بعينها الصيغةُ التي يُصلَح فيها موضعٌ ويُنسى الآخران
 *   فيقول الشريطُ «كلُّ حسابٍ مستعمَل» والبطوليُّ يعرض راكدَين في نفس الرسم.
 *   **والرقاقةُ تُرجع نفسَ المجموعة التي عدَّها الرقم** — لا مرشّحاً ثانياً
 *   يُشتقّ بشرطٍ موازٍ.
 *
 * ★ **والشريطُ يقدّم ما وقع على ما يُتوقَّع** — نفسُ قاعدة شاشة الاستهلاك:
 *   حساباتٌ راكدة (خبرٌ واقعٌ اليوم) ثمّ دعواتٌ لم تُستعمل (كلمةٌ مؤقّتةٌ
 *   سائبةٌ اليوم) ثمّ «مالكٌ واحدٌ نشط» (خطرٌ قد لا يقع أبداً).
 *
 * ★ **ونصوصُ العاقبة لا نصوصُ الحالة**: «معطَّل» حالة، و«لا يستطيع الدخول
 *   وأُبطلت جلساته» عاقبة. وكلُّ زرٍّ خطرٍ يقول أثرَه **قبل** الضغط.
 *
 * ★ **والتأكيدُ داخل الثيم**: `window.confirm` نافذةُ نظامٍ لا تُنسَّق ولا
 *   تحمل نصَّ عاقبة، و`DangerButton` في طبقة المكوّنات تسأل بـ`window.prompt`.
 *   فالتأكيد هنا ورقةٌ صاعدةٌ **واحدةٌ** تخدم كلّ فعلٍ خطر، تقول **من** و**ماذا
 *   يحدث** قبل أن تُظهر الزرّ.
 *
 * ★ **والكلمةُ المؤقّتة تُعرض مرّةً واحدة** — وهذا العقدُ ليس أدباً: الخادم
 *   لا يخزّنها نصّاً في أيّ موضع (`scrypt` باتّجاهٍ واحد)، فإغلاقُ الورقة
 *   بالخطأ يعني أنّها **ضاعت فعلاً** ولا سبيل إليها إلّا إعادةُ تعيينٍ ثانية
 *   تُبطل جلسات صاحبها من جديد. ولذلك الإغلاقُ معلَّقٌ على إقرارٍ صريح، لا على
 *   نقرةٍ يأخذها الإبهام سهواً.
 */

interface Member {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  /** جلسةٌ حيّةٌ = جهازٌ يدخل بلا أن يسأل كلمةَ سرّ. والتعطيل يُبطلها فوراً. */
  liveSessions: number;
}

interface Team {
  /** عتبةُ الرُّكود — من الخادم، فلا تُعاد اختراعُها هنا برقمٍ ثانٍ. */
  staleDays: number;
  /** سقفُ المقاعد في الباقة — و`null` تعني بلا سقفٍ لا صفرَ مقاعد. */
  seats: number | null;
  items: Member[];
}

/** كلمةٌ مؤقّتةٌ في اليد — تُعرض مرّةً واحدةً ثمّ تُنسى من الذاكرة. */
interface Secret {
  who: string;
  email: string;
  pass: string;
  /** دعوةٌ جديدة أم إعادةُ تعيين — النصُّ يفترق، والورقةُ واحدة. */
  fresh: boolean;
}

/** سؤالُ تأكيدٍ واحدٌ يخدم كلّ فعلٍ خطر. */
interface Ask {
  title: string;
  who: string;
  /** ماذا يحدث لو تمّ — عاقبةٌ لا حالة. */
  why: ReactNode;
  label: string;
  danger: boolean;
  run: () => Promise<void>;
}

/** المرشِّحُ اسمُ **مجموعةٍ** من `readTeam` لا شرطٌ ثانٍ يُكتب بجانبها. */
type Filt = 'all' | 'owner' | 'agent' | 'never' | 'stale' | 'off';

export default function TeamPage() {
  const { me } = useSession();
  const { readOnly } = useCan();
  const { data, loading, error, reload } = useApi<Team>('/team');
  /* ★ سجلُّ الحساب — وعدُ لافتة الانتحال («يراه العميل في سجلّه») يُوفى هنا. */
  const audit = useApi<{ items: AuditRow[] }>('/audit');
  const { toast, node: toastNode } = useToast();

  const [filt, setFilt] = useState<Filt>('all');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole>('tenant_agent');
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [who, setWho] = useState<Member | null>(null);
  const [whoOpen, setWhoOpen] = useState(false);

  const [ask, setAsk] = useState<Ask | null>(null);
  const [secret, setSecret] = useState<Secret | null>(null);
  const [ack, setAck] = useState(false);

  /** مالكُ المنصّة المنتحلُ يقرأ ولا يكتب — والخادم يرفض كلّ فعلٍ كاتبٍ أصلاً. */
  const impersonating = readOnly;
  const iAmOwner = me?.user.role === 'tenant_owner';
  const meId = me?.user.id ?? '';
  /** سببُ منعٍ واحدٌ يسبق كلَّ الأسباب — فلا يُكتب في كلّ زرٍّ بصيغةٍ أخرى. */
  const impReason = 'الانتحال قراءةٌ فقط — مسجَّلٌ ويراه العميل في سجلّه.';

  /* ─────────────── الأفعال ─────────────── */

  async function submitInvite() {
    setBusy(true);
    setInviteErr(null);
    try {
      const r = await post<{ member: Member; tempPassword: string }>(
        '/team/invite',
        { name: name.trim(), email: email.trim(), role },
      );
      setInviteOpen(false);
      setAck(false);
      setSecret({ who: r.member.name, email: r.member.email, pass: r.tempPassword, fresh: true });
      setName('');
      setEmail('');
      setRole('tenant_agent');
      await reload();
    } catch (e) {
      setInviteErr(e instanceof ApiError ? e.message : 'تعذّر إنشاء الحساب.');
    } finally {
      setBusy(false);
    }
  }

  async function runActive(m: Member, next: boolean) {
    const r = await post<{ sessionsRevoked: number }>(`/team/${m.id}/active`, { isActive: next });
    await reload();
    toast(next
      ? `أُعيد تفعيل حساب ${m.name} — يستطيع الدخول بكلمته السابقة.`
      : `عُطِّل حساب ${m.name} وأُبطلت ${r.sessionsRevoked} جلسة — لا يستطيع الدخول الآن.`);
  }

  async function runRole(m: Member, next: TeamRole) {
    const r = await patch<{ sessionsRevoked: number }>(`/team/${m.id}/role`, { role: next });
    await reload();
    toast(next === 'tenant_owner'
      ? `${m.name} صار مالكاً — يضبط البوت والقنوات والفوترة ويدعو موظّفين.`
      : `${m.name} صار موظّفاً وأُبطلت ${r.sessionsRevoked} جلسة — لن يرى الإعدادات بعد دخوله من جديد.`);
  }

  async function runReset(m: Member) {
    const r = await post<{ tempPassword: string }>(`/team/${m.id}/reset-password`, {});
    await reload();
    setAck(false);
    setSecret({ who: m.name, email: m.email, pass: r.tempPassword, fresh: false });
  }

  /** كلُّ فعلٍ خطرٍ يمرّ من هنا: يُغلق ورقةَ العضو ويفتح ورقةَ التأكيد. */
  function confirm(a: Ask) {
    setWhoOpen(false);
    setAsk(a);
  }

  async function runAsk() {
    if (!ask) return;
    setBusy(true);
    try {
      await ask.run();
      setAsk(null);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'تعذّر تنفيذ الفعل.');
    } finally {
      setBusy(false);
    }
  }

  function openMember(m: Member) {
    setWho(m);
    setWhoOpen(true);
  }

  if (loading) return <Skeleton rows={5} />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  /* ─────────────── السلّم: مصدرٌ واحدٌ لكلّ رقمٍ ونصٍّ ومرشِّح ─────────────── */

  const stale = data.staleDays;
  const t = readTeam(data.items, stale, data.seats, Date.now());
  const seatPct = data.seats ? t.active.length / data.seats : 0;

  /** ★ المرشِّحُ يُرجع **نفسَ المجموعة** التي عدَّها الرقم — لا شرطاً موازياً. */
  const view: Member[] = filt === 'owner' ? t.owners
    : filt === 'agent' ? t.agents
      : filt === 'never' ? t.never
        : filt === 'stale' ? t.rusty
          : filt === 'off' ? t.off
            : data.items;

  /** آخرُ دخولٍ في الفريق كلِّه — خطُّ أساسٍ لـ«الحساب مستعمَلٌ فعلاً». */
  const lastSeen = t.active
    .map((m) => m.lastLoginAt)
    .filter((x): x is string => Boolean(x))
    .sort()
    .at(-1) ?? null;

  const oldestInvite = t.never.map((m) => m.createdAt).sort().at(0) ?? null;

  /* ★ الشريطُ الحاكم — رتبةٌ واحدةٌ من السلّم، ونصٌّ لكلّ رتبة. */
  const BAND: Record<typeof t.focus, { sev: Sev; head: ReactNode; sub: ReactNode }> = {
    rusty: {
      sev: 'bad',
      head: <>
        <span className="num">{fmt.num(t.rusty.length)}</span> حساباً نشطاً لم يُستعمل منذ أكثر من {stale} يوماً
      </>,
      sub: <>
        من ترك العمل ولم يُعطَّل حسابه يبقى يقرأ محادثات زبائنك ويردّ عليهم باسمك.
        {' '}وتعطيلُ الحساب يُبطل جلساته في نفس اللحظة — لا بعد ربع ساعة.
      </>,
    },
    never: {
      sev: 'warn',
      head: <>
        <span className="num">{fmt.num(t.never.length)}</span> دعوةً لم تُستعمل بعد
      </>,
      sub: <>
        كلمتُها المؤقّتة صالحةٌ لمن يعرفها — وهي لا تُخزَّن نصّاً عندنا.
        {oldestInvite && <> وأقدمُها أُنشئت {fmt.when(oldestInvite)}.</>}
        {' '}فإن ضاعت فأعِد تعيينها، وإن لم تعد لازمةً فعطّل الحساب.
      </>,
    },
    onlyOwner: {
      sev: 'warn',
      head: 'مالكٌ نشطٌ واحدٌ على هذا الحساب',
      sub: <>
        لو فُقد وصولُه لا يستطيع أحدٌ في الفريق دعوةَ موظّفٍ ولا تعطيلَ حسابٍ ولا ضبطَ البوت.
        {' '}رقِّ من تثق به مالكاً — والترقيةُ تُسحب متى شئت.
      </>,
    },
    seatsFull: {
      sev: 'warn',
      head: <>
        كلُّ مقاعد باقتك مشغولة: <span className="num">{fmt.num(t.active.length)}</span> من
        {' '}<span className="num">{fmt.num(data.seats)}</span>
      </>,
      sub: 'لن تستطيع دعوةَ موظّفٍ جديدٍ حتّى تعطّل حساباً لم يعد يُستعمل، أو ترفع باقتك.',
    },
    solo: {
      sev: 'plain',
      head: 'أنت وحدك على هذا الحساب',
      sub: <>
        كلُّ سطرٍ في سجلّ الأفعال باسمك، ولا خروجَ لأحدٍ إلّا بتغيير كلمتك.
        {' '}وأوّلُ موظّفٍ تدعوه يصير له حسابُه وسجلُّه وزرُّ تعطيلٍ خاصٌّ به.
      </>,
    },
    clear: {
      sev: 'good',
      head: 'كلُّ حسابٍ في فريقك مستعمَلٌ وحديث',
      sub: <>
        <span className="num">{fmt.num(t.active.length)}</span> حساباً يستطيع الدخول ·
        {' '}منهم <span className="num">{fmt.num(t.owners.length)}</span> مالكاً
        {' '}و<span className="num">{fmt.num(t.agents.length)}</span> موظّفاً
        {lastSeen && <> · وآخرُ دخولٍ {fmt.when(lastSeen)}</>}
      </>,
    },
  };
  const band = BAND[t.focus];

  /* ─────────────── الجدول ─────────────── */

  const columns: Array<Column<Member>> = [
    {
      key: 'who',
      head: 'العضو',
      /* هويّةُ الصفّ زرٌّ حقيقيّ: هي عنوانُ البطاقة دون 1100 ومفتاحُ تفصيلها،
         ونقرُ `<tr>` وحده فعلٌ للفأرة لا يبلغه مفتاحٌ ولا قارئُ شاشة. */
      cell: (m) => (
        <Row gap="xs" wrap={false}>
          <button type="button" className="sc-rowbtn" dir="auto" onClick={() => openMember(m)}>
            {m.name}
          </button>
          {m.id === meId && <Tag line mark={false} label="أنت" />}
        </Row>
      ),
    },
    {
      key: 'mail',
      head: 'البريد',
      cell: (m) => <span className="tm-mail">{m.email}</span>,
    },
    {
      key: 'role',
      head: 'الدور',
      /* ترميزٌ مزدوج: نصٌّ **ومعه** وجودُ العلامة أو غيابُها — لا لونٌ وحده. */
      cell: (m) => (m.role === 'tenant_owner'
        ? <Tag tone="brand" label="مالكُ الحساب" />
        : <Tag line mark={false} label="موظّف" />),
    },
    {
      key: 'seen',
      head: 'آخر دخول',
      cell: (m) => {
        if (!m.lastLoginAt) return <Pill tone="warn" label="لم يدخل قطّ" />;
        const d = daysSince(m.lastLoginAt, Date.now());
        return (
          <Row gap="xs">
            <span>{fmt.when(m.lastLoginAt)}</span>
            {m.isActive && d >= stale && <Tag tone="serious" label={`راكدٌ منذ ${d} يوماً`} />}
          </Row>
        );
      },
    },
    {
      key: 'state',
      head: 'الحالة',
      cell: (m) => {
        if (!m.isActive) return <Pill tone="crit" label="معطَّل — لا يدخل" />;
        if (m.mustChangePassword && !m.lastLoginAt) return <Pill tone="warn" label="دعوةٌ لم تُستعمل" />;
        if (m.mustChangePassword) return <Pill tone="warn" label="على كلمةٍ مؤقّتة" />;
        return <Pill tone="ok" label="نشط" />;
      },
    },
    {
      key: 'live',
      head: 'جلساتٌ حيّة',
      num: true,
      cell: (m) => (m.isActive ? m.liveSessions : 0),
    },
  ];

  /* رقاقةٌ لا صفوفَ لها لا تُعرض: زرٌّ يُرجع صفراً دائماً يُقرأ عطلاً. */
  const chips: Array<{ f: Filt; label: string }> = [
    { f: 'all', label: 'الكلّ' },
    ...(t.owners.length ? [{ f: 'owner' as Filt, label: 'مالكون' }] : []),
    ...(t.agents.length ? [{ f: 'agent' as Filt, label: 'موظّفون' }] : []),
    ...(t.never.length ? [{ f: 'never' as Filt, label: 'لم يدخل بعد' }] : []),
    ...(t.rusty.length ? [{ f: 'stale' as Filt, label: 'راكدة' }] : []),
    ...(t.off.length ? [{ f: 'off' as Filt, label: 'معطَّلة' }] : []),
  ];

  /* ─────────────── حدودُ أزرار ورقة العضو ─────────────── */

  const lastOwner = who !== null && who.role === 'tenant_owner' && who.isActive && t.owners.length <= 1;
  const isSelf = who?.id === meId;

  return (
    <Stack gap="lg">
      {toastNode}
      <PageHead
        title="الفريق"
        sub="حسابٌ لكلّ موظّف — فيُعرف من فعل ماذا، ويُقفل بابُ من ترك العمل."
        actions={data.seats !== null
          ? <Pill tone="neutral" mark={false} label={`${fmt.num(t.active.length)} / ${fmt.num(data.seats)}`} />
          : undefined}
      />

      <Band sev={band.sev} head={band.head} sub={band.sub} />

      {/* ★ بطوليٌّ **واحد**، يتبدّل بالحالة: الرقمُ الذي لا يعرفه صاحبُ النشاط
          يسبق الرقمَ الذي يعرفه. فحسابٌ نشطٌ لا أحدَ يستعمله خبرٌ، وعددُ
          الأعضاء ليس خبراً — إلّا حين لا يوجد ما هو أخطر منه. */}
      {t.focus === 'rusty' ? (
        <Hero
          sev="bad"
          value={fmt.num(t.rusty.length)}
          label={<>حساباً نشطاً لم يُستعمل منذ أكثر من {stale} يوماً</>}
          ctx={(
            <>
              من <span className="num">{fmt.num(t.active.length)}</span> حساباً يستطيع الدخول ·
              {' '}وعلى <span className="num">{fmt.num(t.liveOn)}</span> منها جلسةٌ حيّةٌ لا تسأل كلمةَ سرّ ·
              {' '}والتعطيلُ يُبطل الجلسة في نفس اللحظة
            </>
          )}
        />
      ) : t.focus === 'never' ? (
        <Hero
          sev="warn"
          value={fmt.num(t.never.length)}
          label="دعوةً أُنشئت ولم تُستعمل بعد"
          ctx={(
            <>
              من <span className="num">{fmt.num(t.active.length)}</span> حساباً نشطاً
              {oldestInvite && <> · وأقدمُها {fmt.when(oldestInvite)}</>} ·
              {' '}وكلمتُها المؤقّتة لا تُخزَّن نصّاً عندنا فلا تُستعاد
            </>
          )}
        />
      ) : (
        <Hero
          sev={t.seatsFull ? 'warn' : 'plain'}
          value={fmt.num(t.active.length)}
          unit={data.seats !== null ? `/ ${fmt.num(data.seats)}` : undefined}
          label="من يستطيع الدخول إلى حسابك الآن"
          meter={data.seats !== null ? { pct: seatPct } : undefined}
          ctx={(
            <>
              منهم <span className="num">{fmt.num(t.owners.length)}</span> مالكاً
              {' '}و<span className="num">{fmt.num(t.agents.length)}</span> موظّفاً ·
              {' '}و<span className="num">{fmt.num(t.live)}</span> جلسةً حيّةً على
              {' '}<span className="num">{fmt.num(t.liveOn)}</span> حساباً
              {lastSeen && <> · وآخرُ دخولٍ {fmt.when(lastSeen)}</>}
            </>
          )}
        />
      )}

      <Section title="بابُ حسابك" sub="كلُّ سطرٍ هنا طريقُ دخولٍ قائمٌ أو مقفول">
        <Rows>
          <MetricRow
            k="مقاعدُ باقتك"
            note="الحسابُ المعطَّل لا يشغل مقعداً — فعطِّل قبل أن ترفع الباقة"
            value={fmt.num(t.active.length)}
            unit={data.seats !== null ? `/ ${fmt.num(data.seats)}` : undefined}
            mid={data.seats !== null
              ? (
                <>
                  <span className="sc-mw"><Meter pct={seatPct} /></span>
                  <span className="sc-ctx"><span className="num">{fmt.pct(seatPct)}</span> من مقاعدك</span>
                </>
              )
              : <span className="sc-ctx">بلا سقفِ مقاعدَ في باقتك</span>}
          />

          <MetricRow
            k="جلساتٌ حيّةٌ الآن"
            note="جهازٌ يدخل بلا أن يسأل كلمةَ سرّ — وتعطيلُ الحساب يُبطلها فوراً"
            value={fmt.num(t.live)}
            mid={t.live
              ? (
                <span className="sc-ctx">
                  على <span className="num">{fmt.num(t.liveOn)}</span> من
                  {' '}<span className="num">{fmt.num(t.active.length)}</span> حساباً نشطاً
                </span>
              )
              : <span className="sc-ctx">لا أحدَ داخلٌ الآن — كلُّ دخولٍ سيسأل كلمةَ سرّ</span>}
          />

          <MetricRow
            k="حساباتٌ راكدة"
            note={`نشطةٌ ولم تُستعمل منذ أكثر من ${stale} يوماً`}
            value={fmt.num(t.rusty.length)}
            mid={t.rusty.length
              ? <Tag tone="serious" label={`${fmt.num(t.rusty.length)} بابٍ مفتوحٍ بلا مستعمِل`} />
              : <span className="sc-ctx">كلُّ حسابٍ نشطٍ مستعمَلٌ حديثاً</span>}
          />

          <MetricRow
            k="دعواتٌ لم تُستعمل"
            note="حسابٌ أُنشئ وكلمتُه المؤقّتة لم تُستهلك بدخولٍ بعد"
            value={fmt.num(t.never.length)}
            mid={t.never.length
              ? <Tag tone="warn" label="كلمةٌ مؤقّتةٌ سائبةٌ لمن يعرفها" />
              : <span className="sc-ctx">كلُّ من دعوتَه دخل فعلاً</span>}
          />

          <MetricRow
            k="حساباتٌ معطَّلة"
            note="لا تدخل ولا تشغل مقعداً — وسجلُّ أفعالها يبقى"
            value={fmt.num(t.off.length)}
            mid={t.off.length
              ? <Tag line mark={false} label="تُعاد بزرٍّ واحدٍ بكلمتها السابقة" />
              : <span className="sc-ctx">لا حسابَ معطَّلاً</span>}
          />
        </Rows>
      </Section>

      <Section
        title="أعضاء فريقك"
        sub={(
          <>
            <span className="num">{fmt.num(view.length)}</span> من
            {' '}<span className="num">{fmt.num(data.items.length)}</span> حساباً —
            {' '}والأخطرُ أوّلاً: من لم يدخل قطّ، ثمّ الأقدمُ دخولاً
          </>
        )}
      >
        {!view.length ? (
          <Empty
            title="لا صفوفَ بهذا المرشِّح"
            hint="المرشِّح الحاليّ لا يطابق أيّ حسابٍ في فريقك. أعِده إلى «الكلّ» من رصيف الشاشة أسفل."
            action={<Button size="sm" onClick={() => setFilt('all')}>أعِده إلى الكلّ</Button>}
          />
        ) : (
          <>
            <div className="sc-tbl">
              <Table columns={columns} rows={view} keyOf={(m) => m.id} onRowClick={openMember} />
            </div>
            <div className="sc-sum">
              <span className="sc-sum-i">يستطيعون الدخول <b className="num">{fmt.num(t.active.length)}</b></span>
              <span className="sc-sum-i">مالكون <b className="num">{fmt.num(t.owners.length)}</b></span>
              <span className="sc-sum-i">موظّفون <b className="num">{fmt.num(t.agents.length)}</b></span>
              <span className="sc-sum-i">جلساتٌ حيّة <b className="num">{fmt.num(t.live)}</b></span>
              <span className="sc-sum-i">معطَّلة <b className="num">{fmt.num(t.off.length)}</b></span>
            </div>
            <p className="muted-p">
              اضغط أيّ صفٍّ لتفتح حسابَ صاحبه — ومنه التعطيلُ وتغييرُ الدور وإعادةُ تعيين كلمةٍ مؤقّتة.
            </p>
          </>
        )}
      </Section>

      {/* ★★ سجلُّ الأفعال — الوعدُ الذي كتبته لافتةُ الانتحال وصفحةُ الخصوصيّة
          («مسجَّلٌ ويراه العميل في سجلّه») ولم يكن له شاشة. وأوّلُ ما يُبحث عنه
          فيه: هل دخل أحدٌ من فريق المنصّة بهويّتنا ومتى — فتلك الصفوفُ موسومةٌ
          لا مدفونة. والفاعلُ من المنصّة يُسمّى بفعله لا باسمه: صفُّه لا يُرى هنا. */}
      <Section
        title="سجلُّ الأفعال"
        sub="آخرُ مئةِ فعلٍ على حسابكم بفاعله ووقته — ودخولُ فريق المنصّة بهويّتكم موسومٌ"
      >
        {audit.error ? (
          <Note tone="crit">تعذّر جلبُ السجلّ — {audit.error}</Note>
        ) : !audit.data ? (
          <Skeleton rows={4} />
        ) : !audit.data.items.length ? (
          <Empty
            title="لا أفعالَ مسجَّلةً بعد"
            hint="كلُّ دعوةٍ وتغييرِ دورٍ وتعطيلٍ ونشرِ نسخةٍ — وكلُّ دخولٍ من فريق المنصّة — يظهر هنا لحظةَ وقوعه."
          />
        ) : (
          <ul className="au-list">
            {audit.data.items.map((r) => (
              <li key={r.id} className={`au-row${r.action === 'tenant.impersonate' ? ' imp' : ''}`}>
                <span className="au-when">{fmt.when(r.createdAt)}</span>
                <span className="au-who" dir="auto">{auditActor(r)}</span>
                <span className={`au-what${auditKnown(r.action) ? '' : ' mono'}`} dir="auto">{auditLabel(r.action)}</span>
                {r.action === 'tenant.impersonate'
                  ? <Pill tone="warn" label="فريق المنصّة — قراءةٌ فقط" />
                  : auditActor(r) === 'فريق المنصّة' && <Pill tone="neutral" label="فريق المنصّة" />}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ★★ وعدا صفحة الخصوصيّة عند إنهاء العلاقة: «تصديرٌ كامل يُرسل إليه، ثمّ حذفٌ
          بعد 60 يوماً». التصديرُ زرٌّ هنا في أيّ وقت، والمحوُ يفعله العامل بعد
          ستّين يوماً من الأرشفة — والرقمُ نفسُه في الصفحة المنشورة وفي الكود. */}
      <Section
        title="بياناتُ الحساب"
        sub="تصديرٌ كاملٌ متى شئت — ومحوٌ نهائيٌّ بعد ستّين يوماً من إنهاء العلاقة"
      >
        <Row gap="sm">
          <Button
            disabled={impersonating}
            reason={impersonating ? impReason : undefined}
            onClick={() => { download('/export', 'aibot-export.json').catch(() => toast('تعذّر التصدير. أعِد المحاولة.')); }}
          >
            صدّر كلَّ بيانات الحساب (JSON)
          </Button>
        </Row>
        <Note>
          <b>عند إنهاء العلاقة</b> يؤرشف فريقُ المنصّة الحساب: يتوقّف الدخولُ والرسائلُ في الحال، وتبقى
          البياناتُ <span className="num">60</span> يوماً يُطلب فيها التصديرُ أو التراجعُ — ثمّ تُمحى نهائيّاً
          بلا رجعة. وتصديرُ الحساب وحذفُ أيّ جهةٍ يُسجَّلان في سجلّ الأفعال أعلاه.
        </Note>
      </Section>

      <Fold summary="لماذا لا نرسل بريد الدعوة، وماذا يُسجَّل في سجلّ الأفعال">
        <Note>
          <b>الكلمةُ المؤقّتة تُملى ولا تُرسَل.</b> لا مُرسِلَ بريدٍ في المنصّة، وزرٌّ يقول
          «أرسلنا دعوة» ولا يُرسِل أسوأ من غيابه: تنتظر موظّفتُك رسالةً لا تأتي وتظنّ العطل عندها.
          فالكلمةُ تظهر لك مرّةً واحدةً، وتُمليها عليها، ويُجبرها النظام على تغييرها عند أوّل دخول.
        </Note>
        <Note>
          <b>وكلُّ فعلٍ هنا يُسجَّل باسم فاعله</b> في سجلّ الأفعال أعلاه: الدعوة وتغييرُ الدور والتعطيل
          وإعادةُ التعيين. وهذا هو المكسبُ الحقيقيّ من الحسابات المنفصلة — حسابٌ واحدٌ مشترك
          يجعل السجلَّ كلَّه باسمٍ واحدٍ فلا يُجيب عن سؤالٍ واحد.
        </Note>
        <Note tone="warn">
          <b>والتعطيل يطرد فعلاً.</b> توكنُ الدخول لا يُسأل عن الحساب في كلّ طلب، فبلا إبطال
          الجلسات يبقى المعطَّلُ يقرأ ويردّ حتّى ينتهي توكنه. ولذلك التعطيلُ يُبطل كلّ جلساته
          في نفس اللحظة — وكذلك تنزيلُ الدور، وإلّا بقي المالكُ المنزَّلُ مالكاً ربعَ ساعة.
        </Note>
      </Fold>

      {/* ★ الرصيف: فعلُ الشاشة الأوّل ومرشّحاتُها في مدى الإبهام. */}
      <ScreenDock hint="الدعوةُ تُنشئ حساباً بكلمةٍ مؤقّتةٍ تظهر مرّةً واحدة — لا رسالةَ بريدٍ تُرسَل.">
        <ChipRow label="مرشّحات">
          {chips.map((c) => (
            <button
              key={c.f}
              type="button"
              className="chipf"
              aria-pressed={filt === c.f}
              onClick={() => setFilt(c.f)}
            >
              {c.label}
            </button>
          ))}
        </ChipRow>
        <Button
          variant="primary"
          size="lg"
          wide
          disabled={impersonating || t.seatsFull}
          reason={impersonating
            ? impReason
            : t.seatsFull
              ? `مقاعدُ باقتك ${data.seats} وكلُّها مشغولة — عطِّل حساباً أو ارفع باقتك.`
              : undefined}
          onClick={() => { setInviteErr(null); setInviteOpen(true); }}
        >
          ادعُ موظّفاً
        </Button>
      </ScreenDock>

      {/* ═══════════ ورقةُ الدعوة ═══════════ */}
      <Sheet
        open={inviteOpen}
        title="ادعُ موظّفاً"
        onClose={() => setInviteOpen(false)}
        hint="يُنشأ الحساب فوراً بكلمةٍ مؤقّتةٍ تُعرض لك مرّةً واحدةً — تُمليها عليه، ويغيّرها عند أوّل دخول."
        footer={(
          <Row gap="xs">
            <Button
              variant="primary"
              busy={busy}
              disabled={impersonating}
              reason={impersonating ? impReason : undefined}
              onClick={() => void submitInvite()}
            >
              أنشِئ الحساب
            </Button>
            <Button variant="quiet" onClick={() => setInviteOpen(false)}>أغلِق</Button>
          </Row>
        )}
      >
        <Stack gap="md">
          {inviteErr && <Alert>{inviteErr}</Alert>}

          {/* ★ `autoComplete="off"` هنا **عكسُ** قاعدة `FormInput`، والعلّة مقلوبة:
              النموذجُ لا يجمع بيانات من يكتبه بل بيانات **غيره**. فحقلٌ يُسمّى
              `name` أو `username` يدعو مديرَ كلمات السرّ أن يحشو اسمَ المالك
              وبريدَه — فيُنشأ حسابٌ ثانٍ للمالك نفسِه باسم موظّفته، أو تُصرف
              الدعوةُ إلى بريدٍ لا يقرؤه أحد. والاسمان مقصودان كذلك: لا `email`
              ولا `username` مجرَّدين، فهما ما تبحث عنه أدواتُ الحشو. */}
          <Field label="الاسم" hint="ما يظهر في سجلّ الأفعال وفي ردوده على الزبائن" id="tm-name">
            <FormInput
              id="tm-name"
              name="invitee-name"
              value={name}
              onChange={setName}
              autoComplete="off"
              placeholder="مثال: سارة العمري"
              required
              enterKeyHint="next"
            />
          </Field>

          <Field label="البريد" hint="به يدخل — ولا تُرسَل إليه رسالة" id="tm-mail">
            <FormInput
              id="tm-mail"
              name="invitee-email"
              type="email"
              inputMode="email"
              dir="ltr"
              value={email}
              onChange={setEmail}
              autoComplete="off"
              placeholder="sara@example.com"
              required
              enterKeyHint="next"
            />
          </Field>

          <Field
            label="الدور"
            hint={iAmOwner
              ? 'الموظّف يرى الإنبوكس وجهات الاتّصال وحدها'
              : 'لا يُنشئ مالكاً إلّا مالكُ الحساب نفسُه'}
            id="tm-role"
          >
            <Select
              id="tm-role"
              value={role}
              onChange={(v) => setRole(v as TeamRole)}
              options={[
                { value: 'tenant_agent', label: 'موظّف — يردّ على الزبائن ولا يضبط شيئاً' },
                ...(iAmOwner
                  ? [{ value: 'tenant_owner', label: 'مالك — يضبط البوت والقنوات والفوترة ويدعو غيره' }]
                  : []),
              ]}
            />
          </Field>

          <Note tone="warn">
            <b>الموظّف لا يرى هذه الشاشة أصلاً</b> ولا شاشاتِ الضبط والفوترة — والخادم يرفض
            طلباتها منه ولو كتب مسارَها بيده. والمالكُ يرى كلَّ ما ترى، ويستطيع تعطيل حسابك
            إن كان معك مالكٌ آخر. فلا تُرقِّ إلّا من تُسلّمه المفاتيح فعلاً.
          </Note>
        </Stack>
      </Sheet>

      {/* ═══════════ ورقةُ العضو ═══════════ */}
      <Sheet
        open={whoOpen}
        title={who ? who.name : 'عضو'}
        onClose={() => setWhoOpen(false)}
        hint="التعطيلُ يُبطل جلساته فوراً · وتنزيلُ الدور كذلك · وإعادةُ التعيين تُظهر كلمةً مؤقّتةً مرّةً واحدة."
        footer={<Button variant="quiet" onClick={() => setWhoOpen(false)}>أغلِق</Button>}
      >
        {who && (
          <Stack gap="md">
            <KV>
              <KVRow k="الاسم"><span dir="auto">{who.name}</span></KVRow>
              <KVRow k="البريد"><span className="tm-mail">{who.email}</span></KVRow>
              <KVRow k="الدور">
                {who.role === 'tenant_owner'
                  ? <Tag tone="brand" label="مالكُ الحساب" />
                  : <Tag line mark={false} label="موظّف" />}
              </KVRow>
              <KVRow k="الحالة">
                {who.isActive
                  ? <Pill tone="ok" label="نشط — يستطيع الدخول" />
                  : <Pill tone="crit" label="معطَّل — لا يستطيع الدخول" />}
              </KVRow>
              <KVRow k="آخر دخول">
                {who.lastLoginAt
                  ? <>{fmt.when(who.lastLoginAt)}</>
                  : <Pill tone="warn" label="لم يدخل قطّ" />}
              </KVRow>
              <KVRow k="جلساتٌ حيّة"><span className="num">{fmt.num(who.liveSessions)}</span></KVRow>
              <KVRow k="أُنشئ">{fmt.when(who.createdAt)}</KVRow>
              <KVRow k="كلمةُ السرّ">
                {who.mustChangePassword
                  ? <Pill tone="warn" label="مؤقّتة — يُجبَر على تغييرها" />
                  : <Pill tone="ok" label="خاصّةٌ به" />}
              </KVRow>
            </KV>

            <Stack gap="sm">
              {who.role === 'tenant_agent' ? (
                <Button
                  disabled={impersonating || !iAmOwner || !who.isActive}
                  reason={impersonating
                    ? impReason
                    : !iAmOwner
                      ? 'لا يُرقّي إلى مالكٍ إلّا مالكُ الحساب نفسُه.'
                      : !who.isActive
                        ? 'الحسابُ معطَّل — أعِد تفعيله أوّلاً.'
                        : undefined}
                  onClick={() => confirm({
                    title: 'ترقيةٌ إلى مالك',
                    who: who.name,
                    why: <>
                      سيرى الفوترة والقنوات وإعداداتِ البوت، ويستطيع دعوةَ موظّفين وتعطيلَ
                      حساباتٍ — بما فيها حسابُك إن بقي معك مالكٌ آخر. والترقيةُ تُسحب متى شئت.
                    </>,
                    label: 'رقِّه مالكاً',
                    danger: false,
                    run: () => runRole(who, 'tenant_owner'),
                  })}
                >
                  رقِّه مالكاً
                </Button>
              ) : (
                <Button
                  disabled={impersonating || lastOwner}
                  reason={impersonating
                    ? impReason
                    : lastOwner
                      ? 'هذا هو المالكُ النشطُ الوحيد — رقِّ غيرَه مالكاً أوّلاً، وإلّا بقي الحساب بلا من يُديره.'
                      : undefined}
                  onClick={() => confirm({
                    title: 'تنزيلٌ إلى موظّف',
                    who: who.name,
                    why: <>
                      لن يرى الفوترة ولا القنوات ولا إعداداتِ البوت ولا هذه الشاشة — يبقى له
                      الإنبوكس وجهاتُ الاتّصال. و<b>كلُّ جلساته تُبطَل الآن</b>، وإلّا بقي
                      مالكاً حتّى ينتهي توكنه بعد ربع ساعة.
                      {isSelf && <> وأنت تُنزّل <b>نفسك</b> — ستُطرد من جلستك في نفس اللحظة.</>}
                    </>,
                    label: 'نزِّله موظّفاً',
                    danger: true,
                    run: () => runRole(who, 'tenant_agent'),
                  })}
                >
                  نزِّله موظّفاً
                </Button>
              )}

              {who.isActive ? (
                <Button
                  variant="danger"
                  disabled={impersonating || isSelf || lastOwner}
                  reason={impersonating
                    ? impReason
                    : isSelf
                      ? 'لا تُعطّل حسابك بنفسك — ستُطرد فوراً ولن تستطيع إعادةَ تفعيله.'
                      : lastOwner
                        ? 'هذا هو المالكُ النشطُ الوحيد — لا يُعطَّل حسابه، وإلّا بقي الحساب بلا من يُديره.'
                        : undefined}
                  onClick={() => confirm({
                    title: 'تعطيلُ الحساب',
                    who: who.name,
                    why: <>
                      لن يستطيع الدخول، و<b>كلُّ جلساته تُبطَل الآن</b> فيُطرد من كلّ جهازٍ
                      داخلٍ عليه. ولا يشغل مقعداً في باقتك بعد ذلك، وسجلُّ أفعاله يبقى كما هو.
                      {who.liveSessions > 0 && <> وله الآن {who.liveSessions} جلسةً حيّة.</>}
                    </>,
                    label: 'عطِّل الحساب',
                    danger: true,
                    run: () => runActive(who, false),
                  })}
                >
                  عطِّل الحساب
                </Button>
              ) : (
                <Button
                  disabled={impersonating || t.seatsFull}
                  reason={impersonating
                    ? impReason
                    : t.seatsFull
                      ? `مقاعدُ باقتك ${data.seats} وكلُّها مشغولة — عطِّل حساباً آخر أو ارفع باقتك.`
                      : undefined}
                  onClick={() => confirm({
                    title: 'إعادةُ تفعيل الحساب',
                    who: who.name,
                    why: <>
                      سيستطيع الدخول <b>بكلمته السابقة</b> — فإن كنتَ لا تعرف من يعرفها،
                      فأعِد تعيين كلمةٍ مؤقّتةٍ بعد التفعيل. ويشغل مقعداً في باقتك من جديد.
                    </>,
                    label: 'أعِد التفعيل',
                    danger: false,
                    run: () => runActive(who, true),
                  })}
                >
                  أعِد التفعيل
                </Button>
              )}

              <Button
                disabled={impersonating || isSelf}
                reason={impersonating
                  ? impReason
                  : isSelf
                    ? 'كلمتُك تُغيَّر من شاشة «كلمة السرّ» — فهي تطلب القديمة وتُبقي جلستك.'
                    : undefined}
                onClick={() => confirm({
                  title: 'إعادةُ تعيين كلمةٍ مؤقّتة',
                  who: who.name,
                  why: <>
                    كلمتُه الحاليّة تتوقّف فوراً، و<b>كلُّ جلساته تُبطَل</b>، وتظهر لك كلمةٌ
                    مؤقّتةٌ <b>مرّةً واحدةً</b> تُمليها عليه — ويُجبَر على تغييرها عند أوّل دخول.
                  </>,
                  label: 'أعِد التعيين',
                  danger: true,
                  run: () => runReset(who),
                })}
              >
                أعِد تعيين كلمةٍ مؤقّتة
              </Button>
            </Stack>
          </Stack>
        )}
      </Sheet>

      {/* ═══════════ ورقةُ التأكيد — داخل الثيم لا نافذةَ نظام ═══════════ */}
      <Sheet
        open={Boolean(ask)}
        title={ask?.title ?? 'تأكيد'}
        onClose={() => setAsk(null)}
        hint="لا شيء يقع قبل أن تضغط زرَّ التأكيد."
        footer={ask
          ? (
            <Row gap="xs">
              <Button
                variant={ask.danger ? 'danger' : 'primary'}
                busy={busy}
                onClick={() => void runAsk()}
              >
                {ask.label}
              </Button>
              <Button variant="quiet" onClick={() => setAsk(null)}>تراجَع</Button>
            </Row>
          )
          : undefined}
      >
        {ask && (
          <Stack gap="sm">
            <KV>
              <KVRow k="على الحساب"><span dir="auto">{ask.who}</span></KVRow>
            </KV>
            {/* نصُّ عاقبةٍ لا نصُّ حالة: ماذا يحدث، لا ما هو قائم */}
            <Note tone={ask.danger ? 'warn' : 'brand'}>{ask.why}</Note>
          </Stack>
        )}
      </Sheet>

      {/* ═══════════ الكلمةُ المؤقّتة — مرّةٌ واحدةٌ فقط ═══════════ */}
      <Sheet
        open={Boolean(secret)}
        title="كلمةٌ مؤقّتةٌ تُعرض مرّةً واحدة"
        /* ★ الإغلاقُ معلَّقٌ على إقرار: الكلمةُ لا تُخزَّن نصّاً عندنا، فإغلاقٌ
           سهواً يُضيّعها فعلاً — ولا سبيل إليها إلّا إعادةُ تعيينٍ ثانية تُبطل
           جلسات صاحبها من جديد. والمخرجُ ليس مصيدةً: المفتاحُ أمام العين. */
        onClose={() => {
          if (ack) { setSecret(null); setAck(false); return; }
          toast('انسخ الكلمةَ أوّلاً — لن تظهر ثانيةً، ولا تُخزَّن نصّاً عندنا.');
        }}
        hint="لا تُخزَّن نصّاً في أيّ مكان عندنا — لا في سجلٍّ ولا في قاعدة. وإن ضاعت فأعِد تعيينها."
        footer={(
          <Button
            variant="primary"
            disabled={!ack}
            reason={!ack ? 'أقرِّ أنّك نسختَها أو كتبتَها — فهي لن تظهر ثانيةً.' : undefined}
            onClick={() => { setSecret(null); setAck(false); }}
          >
            نسختُها — أغلِق
          </Button>
        )}
      >
        {secret && (
          <Stack gap="md">
            <Alert>
              <b>هذه آخرُ مرّةٍ تراها.</b> كلماتُ السرّ عندنا مخزَّنةٌ باتّجاهٍ واحد، فلا
              موضعَ تُقرأ منه بعد إغلاق هذه الورقة — ولا نستطيع نحن قراءتها أيضاً.
            </Alert>

            <div className="tm-secret">
              <span className="tm-secret-l">
                {secret.fresh ? 'كلمةُ الدخول المؤقّتة لحساب' : 'الكلمةُ المؤقّتة الجديدة لحساب'}
                {' '}<span dir="auto">{secret.who}</span>
              </span>
              <CodeBlock text={secret.pass} />
              <span className="tm-secret-l">
                يدخل بها على البريد <span className="tm-mail">{secret.email}</span>
              </span>
            </div>

            <Note>
              <b>أملِها عليه ولا تُرسِلها في محادثة.</b> حروفُها مختارةٌ بلا ما يلتبس صوتاً
              أو نظراً — لا صفر مع O ولا واحد مع L. وعند أوّل دخولٍ يطلب النظام منه
              كلمةً خاصّةً به، فتتوقّف هذه عن العمل ولا تبقى سرّاً بينكما.
            </Note>

            <Toggle
              id="tm-ack"
              checked={ack}
              onChange={setAck}
              label="نسختُها أو كتبتُها — أعرف أنّها لن تظهر ثانيةً"
            />
          </Stack>
        )}
      </Sheet>
    </Stack>
  );
}
