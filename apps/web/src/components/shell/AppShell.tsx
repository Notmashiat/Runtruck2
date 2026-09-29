'use client';

import type { ReactNode } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

// Runtruck1 AppLayout: sidebar, then a column with the top bar and the page.
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="ui-shell">
      <Sidebar />
      <div className="ui-column">
        <Header />
        <main className="ui-main">{children}</main>
      </div>
    </div>
  );
}
