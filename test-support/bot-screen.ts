import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★ شاشةُ البوت صارت تسعةَ ملفّاتٍ لا ملفّاً واحداً (#83): الحالةُ في `state.tsx`،
 *   والأنواعُ والمساعداتُ في `parts.tsx`، وكلُّ تبويبٍ في ملفّه. والحرّاسُ التي
 *   تمسح «الشاشة» تقرؤها كلَّها — وإلّا مرّ حارسٌ على ملفٍّ صار يحمل الغلافَ وحده.
 *
 *   الترتيبُ ثابتٌ ومقصود: الأنواع ← الحالة ← الغلاف ← التبويبات، فحارسٌ يقارن
 *   مواضعَ (`indexOf`) يقرأ ما يُعرَّف قبل ما يُستعمل.
 */
const REPO = join(__dirname, '..');
const DIR = 'apps/web/src/app/app/bot';

export const BOT_SCREEN: readonly string[] = [
  'parts.tsx', 'state.tsx', 'page.tsx',
  'PersonaTab.tsx', 'KbTab.tsx', 'ToolsTab.tsx', 'BehaveTab.tsx', 'VersionsTab.tsx',
].map((f) => `${DIR}/${f}`);

/** المسارات المطلقة — لحرّاسٍ تمرّ على قائمة ملفّات. */
export const BOT_SCREEN_ABS: readonly string[] = BOT_SCREEN.map((p) => join(REPO, p));

/** نصُّ الشاشة كلُّها خامّاً، ملفّاً بعد ملفّ. */
export function readBotScreen(): string {
  return BOT_SCREEN_ABS.map((p) => readFileSync(p, 'utf8')).join('\n');
}
