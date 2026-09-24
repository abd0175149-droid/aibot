import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * ★ عنوانٌ لكلّ شاشة — وكانت التبويباتُ كلُّها بعنوانٍ واحد.
 *
 *   من يفتح خمسَ شاشاتٍ في خمس تبويبات (وهو ما يفعله الموظّف فعلاً: إنبوكسٌ
 *   وجهةُ اتّصالٍ وتقرير) يرى خمسَ تبويباتٍ متطابقةٍ لا يميّز بينها، ولا يجد
 *   شيئاً في سجلّ المتصفّح ولا في بحثه. والصفحةُ هنا مكوّنُ عميل، فلا تحمل
 *   `metadata` — وهذا الغلافُ يحملها عنها.
 */
export const metadata: Metadata = {
  title: 'كلمة المرور',
  description: 'غيّر كلمةَ مرورك.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
