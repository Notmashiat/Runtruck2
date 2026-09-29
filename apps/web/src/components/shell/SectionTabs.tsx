'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useShellUi } from '@/context/ShellUiContext';
import { parseAppPath, SECTION_TABS } from '@/lib/nav';

// The centred pill bar under the top bar. Only sections listed in
// SECTION_TABS have one; each tab is its own URL (/app/<section>/<tab>).
// Moving between tabs clears the search, as the sidebar does between sections.
export function SectionTabs() {
  const pathname = usePathname();
  const { setQuery } = useShellUi();
  const { view } = parseAppPath(pathname);
  const tabs = SECTION_TABS[view];
  if (!tabs) return null;
  const current = pathname.toLowerCase();

  return (
    <nav className="ui-tabs">
      {tabs.map((t) => {
        const href = `/app/${view}/${t.key}`;
        // react-router NavLink semantics: active when the path is the tab or below it.
        const active = current === href || current.startsWith(`${href}/`);
        return (
          <Link
            key={t.key}
            href={href}
            scroll={false}
            onClick={() => setQuery('')}
            aria-current={active ? 'page' : undefined}
            className={`ui-tab${active ? ' is-active' : ''}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
