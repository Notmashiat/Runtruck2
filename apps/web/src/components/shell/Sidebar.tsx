'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type MouseEvent, useRef, useState } from 'react';
import { useSession } from '@/context/SessionContext';
import { useShellUi } from '@/context/ShellUiContext';
import { api, ApiError } from '@/lib/api/client';
import { NAV, parseAppPath } from '@/lib/nav';
import { SettingsDialog } from './SettingsDialog';

// Shown when the API could not end the session (docs/01 C78).
const LOGOUT_FAILED_CONFIRM =
  'Log out did not finish, so you are still signed in.\n\nPress OK to try again, or Cancel to sign out of this browser only.';
const LOGOUT_FALLBACK_FAILED_ALERT = 'Could not sign out. You are still signed in. Try again in a moment.';

// Ends the session on the API. True once it is gone: ended now, or already ended (401).
async function endServerSession(): Promise<boolean> {
  try {
    await api.post('/auth/logout');
    return true;
  } catch (err) {
    return err instanceof ApiError && err.status === 401;
  }
}

// The fallback when the API cannot be reached: the web origin clears this browser's
// httpOnly session cookie (app/sign-out/route.ts). The server session then simply expires.
async function clearBrowserSession(): Promise<boolean> {
  try {
    const res = await fetch('/sign-out', { method: 'POST', credentials: 'same-origin' });
    return res.ok;
  } catch {
    return false;
  }
}

export function Sidebar() {
  const pathname = usePathname();
  const { setQuery } = useShellUi();
  const { me, can } = useSession();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const loggingOut = useRef(false);
  const activeKey = parseAppPath(pathname).view;

  // Runtruck1's "Log out" was a plain link to "/". It keeps that markup, but first ends the
  // server session, and it fails closed (docs/01 C78): the page is left only once the
  // session is gone. Otherwise the member stays signed in here and chooses to try again or
  // to clear this browser's cookie through the web origin.
  async function logOut(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (loggingOut.current) return;
    loggingOut.current = true;
    let signedOut = await endServerSession();
    while (!signedOut && window.confirm(LOGOUT_FAILED_CONFIRM)) signedOut = await endServerSession();
    if (!signedOut) signedOut = await clearBrowserSession();
    if (!signedOut) {
      loggingOut.current = false;
      window.alert(LOGOUT_FALLBACK_FAILED_ALERT);
      return;
    }
    // A full page load drops every cached query of the ended session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/');
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
