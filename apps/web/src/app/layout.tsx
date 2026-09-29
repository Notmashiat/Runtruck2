import type { Metadata } from 'next';
import type { ReactNode } from 'react';
// Global CSS in Runtruck1's cascade order: industry → app → shell → calendar.
// Imported once, here, so Next cannot reorder the chunks.
import '@runtruck/ui/styles/industry.css';
import '../styles/app.css';
import '@runtruck/ui/styles/shell.css';
import '../styles/calendar.css';
import '../styles/login.css';

export const metadata: Metadata = {
  title: 'RunTruck',
  icons: { icon: { url: '/favicon.svg', type: 'image/svg+xml' } },
};

// Applies a saved dark theme before first paint (Runtruck1 index.html did the same).
const THEME_SCRIPT = `try{document.documentElement.dataset.theme=localStorage.getItem('runtruck-theme')==='dark'?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* The same Google Fonts link as Runtruck1 (next/font would rename the families). */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;700&family=Barlow+Condensed:wght@400;600&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* app.css sizes #root; Runtruck1 rendered into <div id="root">. */}
        <div id="root">{children}</div>
      </body>
    </html>
  );
}
