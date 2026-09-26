import type { Role, TenantStatus } from './api.js';

/**
 * ★★ **أشكالُ الردود التي تتّفق عليها الواجهةُ والـAPI — في موضعٍ واحد.**
 *
 *   كانت الواجهةُ تُعلن ٨١ نوعاً محلّيّاً تُطابق ردودَ الخادم **باليد**، والعقدُ
 *   المشترك ثلاثةُ مخطّطاتٍ فقط. والانحرافُ وقع فعلاً: `/me` صار يحمل أجلَ
 *   الانتحال ولا يعرفه نوعُ الواجهة إلّا بعد تعديلٍ يدويٍّ ثانٍ.
 *
 *   هنا البطاقتان اللتان تقرؤهما كلُّ شاشة: `MeDTO` (الجلسة) و`OverviewDTO`
 *   (الرئيسيّة وذيلُ القشرة). الخادمُ يُعلن دالّتَه بهما فيرفض TypeScript أيَّ
 *   حقلٍ يُضاف من جهةٍ ولا يُقرأ من الأخرى، والواجهةُ تستوردهما بدل إعادة
 *   كتابتهما.
 *
 * ⚠️ أنواعٌ لا مخطّطاتُ zod عمداً: هذه ردودٌ **نكتبها نحن** لا مدخلاتٌ من
 *    الخارج — والتحقّقُ الوحيدُ المطلوب فيها هو تطابقُ الطرفين، وهذا عملُ المُصرِّف.
 */

export interface PermissionsDTO {
  write: boolean;
  settings: boolean;
  billing: boolean;
  console: boolean;
}

export interface MeDTO {
  user: {
    id: string;
    name: string;
    email: string;
    role: Role;
    /** كلمةٌ مؤقّتةٌ يعرفها من عيّنها — والقشرةُ تحبس صاحبَها في شاشة التغيير. */
    mustChangePassword: boolean;
  };
  tenant: { id: string; name: string; status: TenantStatus; capabilities: Record<string, boolean> } | null;
  permissions: PermissionsDTO;
  /** معرّفُ المستأجر المُنتحَل — أو `null`. */
  impersonating: string | null;
  /** أجلُ الانتحال (ISO) — القشرةُ تعدّ تنازليّاً وتخرج قبله بقليل. */
  impersonationExpiresAt: string | null;
  /**
   * حالةُ العامل الثاني — ثلاثٌ لا علَمٌ ثنائيّ:
   * `pending` لم يُسجّل بعد · `stale` سجَّل وهذا التوكن لم يخطُ الخطوةَ الثانية · `ok`.
   */
  mfa: 'ok' | 'stale' | 'pending';
}

export interface ChannelSummaryDTO {
  kind: string;
  status: string;
  displayName: string | null;
}

export interface QuotaAlertDTO {
  threshold: number;
  /** ISO — الخادمُ يُسلسِله صراحةً، فلا يمرّ `Date` خامٌّ عبر العقد. */
  firedAt: string;
}

/** ردُّ `/reports/overview` — تقرؤه الرئيسيّةُ كاملاً وذيلُ القشرة ثلاثةَ حقولٍ منه. */
export interface OverviewDTO {
  conversationsToday: number;
  botReplies: number;
  needsAttention: number;
  medianLatencyMs: number;
  selfResolvedRate: number;
  windowsUsed: number;
  windowsLimit: number;
  botEnabled: boolean;
  overagePolicy: string;
  /** نصُّ العاقبة من الخادم — نفسُ نصّ الإشعار الذي يدفعه العامل. */
  capConsequence: string;
  /** عتباتٌ أُنذر بها فعلاً في هذه الدورة (من `quota_alerts`)، تصاعديّاً. */
  quotaAlerts: QuotaAlertDTO[];
  channels: ChannelSummaryDTO[];
}
