'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type MouseEvent, useState } from 'react';
import { useSession } from '@/context/SessionContext';
import { useShellUi } from '@/context/ShellUiContext';
import { api } from '@/lib/api/client';
import { NAV, parseAppPath } from '@/lib/nav';
import { SettingsDialog } from './SettingsDialog';

export function Sidebar() {
  const pathname = usePathname();
  const { setQuery } = useShellUi();
  const { me, can } = useSession();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const activeKey = parseAppPath(pathname).view;

  // Runtruck1's "Log out" was a plain link to "/". It keeps that markup, but
  // first ends the server session so the cookie can no longer be used.
  async function logOut(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    try {
      await api.post('/auth/logout');
    } finally {
      // A full page load drops every cached query of the ended session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign('/');
    }
  }

  return (
    <aside className="ui-sidebar">
      <div className="ui-brand">
        <span className="ui-brand-mark" />
        RunTruck
      </div>

      <nav className="ui-nav">
        {NAV.filter((n) => can(n.permission)).map((n) => (
          <Link
            key={n.key}
            href={`/app/${n.key}`}
            scroll={false}
            onClick={() => {
              setQuery('');
            }}
            className={`ui-nav-item${n.key === activeKey ? ' is-active' : ''}`}
          >
            {n.label}
          </Link>
        ))}
      </nav>

      <div className="ui-sidebar-foot">
        <div className="ui-user">
          <div className="ui-user-name">{me.user.fullName}</div>
          <div className="ui-user-meta">
            {me.user.title} · {me.organization.name}
          </div>
        </div>
        <button
          type="button"
          className="ui-nav-item"
          onClick={() => {
            setSettingsOpen(true);
          }}
        >
          Settings
        </button>
        {/* A full page load on purpose: it drops every cached query of the ended session. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="ui-nav-item" onClick={logOut}>
          Log out
        </a>
      </div>

      {settingsOpen && (
        <SettingsDialog
          onClose={() => {
            setSettingsOpen(false);
          }}
        />
      )}
    </aside>
  );
}
