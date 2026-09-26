export * from './schema/_common';
export * from './schema/platform';
export * from './schema/channel';
export * from './schema/bot';
export * from './schema/ops';

import * as platform from './schema/platform';
import * as channel from './schema/channel';
import * as bot from './schema/bot';
import * as ops from './schema/ops';

/**
 * الجداول المستأجَرة — كلّ جدولٍ هنا يحمل `tenant_id` وعليه RLS وCASCADE.
 * هذه القائمة ليست توثيقاً: يقرأها مولّد الترحيل واختبار التسرّب معاً،
 * فجدولٌ جديد يُنسى منها يسقط في الاختبار لا في الإنتاج.
 */
export const TENANT_SCOPED = [
  'users', 'subscriptions', 'audit_log',
  'tenant_channels', 'contacts', 'channel_identities', 'conversations',
  'messages', 'conversation_windows', 'optouts',
  'bot_configs', 'bot_versions', 'bot_tools', 'knowledge_sources',
  'kb_chunks', 'kb_retrievals', 'kb_evals', 'ai_runs', 'ai_keys',
  'incidents', 'health_checks', 'notifications', 'push_subscriptions',
  'quota_alerts',
] as const;

/**
 * الجداول العامّة الوحيدة المسموح بها خارج RLS — وكلّ ما عداها يسقط في الاختبار.
 *  • tenants · plans · prices — مرجعيّة، تُقرأ ولا تُكتب من دور التطبيق.
 *  • sessions — مفتاحها user_id، ومحميّةٌ بأنّ الجلسة تُطابَق بتجزئة التوكن.
 * ملاحظة: جداولٌ فيها tenant_id قابلٌ للفراغ (audit_log · incidents ·
 * push_subscriptions · notifications) تبقى تحت RLS: صفوف مالك المنصّة
 * (tenant_id فارغ) لا تُطابق أيّ سياقِ مستأجر — وهذا هو السلوك المطلوب،
 * والوصول إليها يمرّ بـwithPlatform وحده.
 */
export const GLOBAL_TABLES = ['tenants', 'plans', 'prices', 'sessions'] as const;

export const schema = { ...platform, ...channel, ...bot, ...ops };
