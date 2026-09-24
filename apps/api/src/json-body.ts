import { AppError, ErrorCode } from '@aibot/shared';

/**
 * ★ **التسامحُ كان للويبهوك ووُزّع على كلّ مسار.**
 *
 *   محلّلُ `application/json` مُسجَّلٌ على النسخة الجذر، وكان يُعيد `{}` عن كلّ
 *   جسمٍ مشوّه: «حمولةٌ مشوّهة: 200 ثمّ تسجيل — لا 400 يعطّل الويبهوك». وهي
 *   قاعدةٌ صحيحةٌ **للويبهوك وحده**: ميتا تُعيد المحاولة على 400 وقد توقف
 *   الاشتراك، فابتلاعُ المشوّه هناك قرارٌ مقصود.
 *
 *   لكنّه سرى على كلّ شيء. ومسارانِ يقرآن `Boolean(req.body?.x)`:
 *   `POST /team/:id/active` و`POST /bot/toggle`. فجسمٌ مقطوعٌ في الشبكة —
 *   `{"isActive": tru` — يصير `{}`، و`Boolean(undefined)` تصير `false`:
 *   **يُعطَّل عضوٌ وتُبطَل جلساتُه**، أو يُطفأ بوتُ العميل عن كلّ زبائنه.
 *   والطلبُ يعود 200 فلا شيءَ يقول إنّ ما وقع غيرُ ما قُصد.
 *
 * ★ والمسارُ هو ما يُفرّق لا نوعُ المحتوى: كلاهما `application/json`.
 *
 * ⚠️ ودالّةٌ نقيّةٌ في ملفٍّ مستقلّ لأنّ `main.ts` يُنفّذ `await app.listen`
 *    في أعلاه، فلا يُستورَد في اختبار. والقرارُ هنا ليُفحَص فعلاً.
 */

/** بادئةُ مسارات الويبهوك — وهي وحدها ما يستحقّ التسامح. */
export const WEBHOOK_PREFIX = '/api/webhooks/';

export function isWebhookPath(url: string | undefined): boolean {
  /* المسارُ قد يحمل استعلاماً (`?hub.challenge=…`)، فالمقارنةُ على البادئة. */
  return typeof url === 'string' && url.startsWith(WEBHOOK_PREFIX);
}

/**
 * يُعيد الجسمَ المحلَّل، أو يرمي `AppError` بـ400 على غير الويبهوك.
 *
 * ⚠️ و`AppError` لا `SyntaxError`: خطأٌ بلا `statusCode` يمرّ بمعالج الأخطاء
 *    في `main.ts` فيصير **٥٠٠ «خطأ داخليّ»** — يُقرأ عطلاً عندنا وهو حمولةٌ
 *    مشوّهةٌ من العميل، ويُغرق السجلَّ بما ليس عطلاً.
 */
export function parseJsonBody(url: string | undefined, raw: Buffer): unknown {
  /* جسمٌ فارغٌ يبقى `{}` في الحالتين: لا مُنادِيَ أوّليّاً يرسل نوعَ محتوى
     JSON بجسمٍ فارغ، وتشديدُه يشتري لا شيء ويفتح مسارَ ٤٠٠ جديداً. */
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    if (isWebhookPath(url)) return {};
    throw new AppError(ErrorCode.VALIDATION, 'جسمُ الطلب ليس JSON صالحاً', 400);
  }
}
