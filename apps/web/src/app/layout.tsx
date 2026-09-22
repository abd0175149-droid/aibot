import './globals.css';
import './components.css';
/* الترتيب مقصود: الإطار عامٌّ، والإنبوكس تخصيصٌ عليه فيأتي بعده. */
import './shell.css';
import './inbox.css';
import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { SessionProvider } from '@/lib/session';
import { ThemeProvider, THEME_BOOT_SCRIPT } from '@/lib/theme';

export const metadata: Metadata = {
  title: 'AiBot — منصّة بوتات ذكيّة',
  description: 'بوت واتساب وإنستجرام مخصَّص لنشاطك، تديره بنفسك.',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // يطابق --bg في كلّ ثيم — شريط المتصفّح على الهاتف يستعمله
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#e7ebe8' },
    { media: '(prefers-color-scheme: dark)', color: '#0a100f' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // RTL أصليّ على الجذر — لا انعكاسٌ لتصميمٍ إنجليزيّ
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        {/* ★ قبل أوّل رسم: يقرأ الاختيار المحفوظ ويكتب data-theme.
            متزامنٌ عمداً وليس مكوّن React — React يعمل بعد الرسم الأوّل،
            فتكون ومضة الثيم قد وقعت. ولهذا وُضع suppressHydrationWarning
            على <html> أصلاً: بصمةُ استعدادٍ لسكربتٍ لم يُكتب حتّى الآن. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        <ThemeProvider>
          <SessionProvider>{children}</SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
