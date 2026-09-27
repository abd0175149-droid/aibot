/**
 * ★ تسميةُ صفوف سجلّ الأفعال — خالصةٌ بلا React فتُختبر بالتنفيذ.
 *
 *   `audit_log.action` رمزٌ آليّ (`team.role_change`)، وصاحبُ المطعم يقرأ
 *   «غُيّر دورُ عضو». والرمزُ المجهول لا يُخفى: يُعرض كما هو بخطٍّ أحاديّ،
 *   فصفٌّ يُقرأ غامضاً خيرٌ من صفٍّ لا يُقرأ.
 */

export interface AuditRow {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  createdAt: string;
  ip: string | null;
  /** فارغٌ حين الفاعلُ من فريق المنصّة (صفُّه خارج RLS المستأجر) أو حسابٌ أُزيل. */
  actorName: string | null;
  actorEmail: string | null;
  /** للصفّ فاعلٌ (لا يُرسَل معرّفُه). موجودٌ بلا اسمٍ = فريقُ المنصّة؛ غائبٌ = حسابٌ حُذف. */
  hasActor?: boolean;
}

/** الأفعالُ التي لا يقوم بها إلّا فريقُ المنصّة — فاعلُها الفارغُ يُسمّى به. */
const PLATFORM_ACTIONS = new Set([
  'tenant.create', 'tenant.impersonate', 'tenant.kill_bot', 'tenant.unlock_bot', 'tenant.status',
  'tenant.owner_password_reset', 'tenant.channel_secrets_read', 'bot.seed', 'platform.reprice',
]);

const LABELS: Record<string, string> = {
  'tenant.impersonate': 'دخل فريق المنصّة بهويّة حسابكم — قراءة فقط، ٣٠ دقيقة',
  'tenant.create': 'أنشئ الحساب',
  'tenant.status': 'غيّر فريق المنصّة حالة الحساب',
  'tenant.kill_bot': 'أوقف فريق المنصّة البوت وقفله',
  'tenant.unlock_bot': 'رفع فريق المنصّة القفل عن البوت',
  'bot.publish': 'نشرت نسخة جديدة من البوت',
  'bot.toggle': 'شغّل البوت أو أوقف',
  'bot.tool_create': 'أنشئت أداة HTTP',
  'bot.tool_update': 'عدّلت أداة HTTP',
  'bot.tool_delete': 'حذفت أداة HTTP',
  'tenant.owner_password_reset': 'أعاد فريق المنصّة كلمة مرور المالك وأسقط جلساته',
  'tenant.channel_secrets_read': 'قرأ فريق المنصّة بيانات الويبهوك',
  'channel.connect': 'ربطت القناة أو جدّد توكنها',
  'bot.seed': 'بذر فريق المنصّة أوّل نسخة بوت',
  'bot.config': 'غيّرت إعدادات البوت',
  'bot.rollback': 'أعيدت نسخة سابقة من البوت',
  'bot.knowledge_gap_filled': 'سدّت فجوة في معرفة البوت',
  'team.invite': 'دعي عضو جديد',
  'team.role_change': 'غيّر دور عضو',
  'team.password_reset': 'أعيد تعيين كلمة مؤقّتة لعضو',
  'user.password_change': 'غيّرت كلمة مرور',
  'auth.mfa_enroll': 'فعّل العامل الثاني',
  'auth.mfa_verify': 'اجتيز العامل الثاني',
  'contact.block': 'حجب رقم',
  'contact.unblock': 'رفع حجب رقم',
  'contact.optout': 'سجّل عدول زبون عن المراسلة',
  'contact.optin': 'أعيد اشتراك زبون',
  'contact.merge': 'دمجت جهتا اتّصال',
  'contact.merge_undo': 'ألغي دمج جهتي اتّصال',
  'platform.reprice': 'أعاد فريق المنصّة تسعير أشواط سابقة بسعر مصحّح',
  'contact.export': 'صدّر ملفّ جهة اتّصال',
  'contact.delete': 'حذفت جهة اتّصال وكلّ بياناتها نهائيّا',
  'tenant.export': 'صدّرت بيانات الحساب كاملة',
  'tenant.profile': 'عدّل ملفّ النشاط وصفحاته العامّة',
  'deletion_request.done': 'أغلق طلب حذف بيانات زبون — نفّذ',
  'deletion_request.refused': 'رفض طلب حذف بيانات زبون مع ذكر السبب',
  'channel.meta_revoked': 'سحب صاحب الحساب إذن إنستجرام من فيسبوك',
};

export function auditLabel(action: string): string {
  return LABELS[action] ?? action;
}

/** هل الرمزُ معروفٌ — أم يُعرض خامّاً؟ (الشاشة تختار خطّاً أحاديّاً للخامّ.) */
export function auditKnown(action: string): boolean {
  return action in LABELS;
}

/**
 * اسمُ الفاعل. الفارغُ يُفسَّر بالفعل لا يُترك «—»: فعلُ منصّةٍ بلا اسمٍ هو
 * فريقُ المنصّة (صفُّه لا يُرى تحت RLS المستأجر — وهذا مقصود)، وغيرُه حسابٌ
 * أُزيل من الفريق بعد فعله.
 */
export function auditActor(row: Pick<AuditRow, 'action' | 'actorName' | 'actorEmail' | 'hasActor'>): string {
  if (row.actorName) return row.actorName;
  if (row.actorEmail) return row.actorEmail;
  /* ★ الحقيقةُ من الخادم أوّلاً: فاعلٌ موجودٌ بلا اسمٍ مرئيٍّ لا يكون إلّا من فريق
     المنصّة. واسمُ الفعل احتياطٌ لصفوفٍ قديمةٍ بلا الحقل — وكان وحده يُخطئ في
     «نُشرت نسخة» بذرها فريقُ المنصّة. */
  if (row.hasActor === true) return 'فريق المنصّة';
  /* بلا فاعل: سكربتُ منصّةٍ (`platform.reprice`) أو حسابٌ حُذف بعد فعله. */
  return PLATFORM_ACTIONS.has(row.action) ? 'فريق المنصّة' : 'حساب أزيل من الفريق';
}

export const isPlatformEntry = (action: string): boolean => PLATFORM_ACTIONS.has(action);
