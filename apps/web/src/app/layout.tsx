import './globals.css';
import './components.css';
import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { SessionProvider } from '@/lib/session';

export const metadata: Metadata = {
  title: 'AiBot — منصّة بوتات ذكيّة',
  description: 'بوت واتساب وإنستجرام مخصَّص لنشاطك، تديره بنفسك.',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f1f3f2' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1110' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // RTL أصليّ على الجذر — لا انعكاسٌ لتصميمٍ إنجليزيّ
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
