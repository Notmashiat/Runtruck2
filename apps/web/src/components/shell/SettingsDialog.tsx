'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/context/SessionContext';
import { applyTheme, getTheme, type Theme } from '@/lib/theme';

type Page = 'Profile' | 'Appearance';
const PAGES: Page[] = ['Profile', 'Appearance'];

// The Settings popup opened from the sidebar: a small menu on the left, the
// chosen page on the right. A native <dialog> opened with showModal() gives
// focus trapping, Escape-to-close and focus return to the Settings button;
// every close path goes through close() so the parent hears one 'close' event.
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [page, setPage] = useState<Page>('Profile');
  const [theme, setTheme] = useState<Theme>(getTheme);

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  const close = () => ref.current?.close();

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  };

  return (
    <dialog
      ref={ref}
      className="ui-dialog"
      aria-label="Settings"
      onClose={onClose}
      onPointerDown={(e) => {
        // A press on the backdrop targets the dialog element itself.
        if (e.target === e.currentTarget) close();
      }}
    >
      <aside className="ui-dialog-nav">
        <div className="ui-dialog-title">Settings</div>
        {PAGES.map((p) => (
          <button key={p} type="button" className={`ui-dialog-nav-item${page === p ? ' is-active' : ''}`} onClick={() => setPage(p)}>
            {p}
          </button>
        ))}
      </aside>
      <section className="ui-dialog-body">
        <button type="button" className="ui-dialog-close" onClick={close} aria-label="Close">
          ×
        </button>
        {page === 'Profile' ? <ProfilePage /> : <AppearancePage theme={theme} onToggle={toggleTheme} />}
      </section>
    </dialog>
  );
}

function ProfilePage() {
  const { me } = useSession();
  const initials = me.user.fullName
    .split(' ')
    .map((part) => part[0])
    .join('');

  return (
    <>
      <h2 className="ui-h2" style={{ margin: 0 }}>
        Profile
      </h2>
      <div className="ui-profile">
        <div className="ui-avatar">{initials}</div>
        <div>
          <div className="ui-profile-name">{me.user.fullName}</div>
          <div className="ui-profile-meta">
            {me.user.title} · {me.organization.name}
          </div>
        </div>
      </div>
      <dl className="ui-ids">
        <div>
          <dt className="ui-label">Member ID</dt>
          <dd>{me.user.memberNumber}</dd>
        </div>
        <div>
          <dt className="ui-label">Company ID</dt>
          <dd>{me.organization.companyNumber}</dd>
        </div>
        <div className="is-wide">
          <dt className="ui-label">Email</dt>
          <dd>{me.user.email}</dd>
        </div>
      </dl>
    </>
  );
}

function AppearancePage({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const dark = theme === 'dark';

  return (
    <>
      <h2 className="ui-h2" style={{ margin: 0 }}>
        Appearance
      </h2>
      <div className="ui-setting">
        <div>
          <div id="dark-mode-label" className="ui-setting-name">
            Dark mode
          </div>
          <div className="ui-setting-help">Darkens the whole site, including the marketing page. Remembered on this device.</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={dark}
          aria-labelledby="dark-mode-label"
          className={`ui-switch${dark ? ' is-on' : ''}`}
          onClick={onToggle}
        >
          <span className="ui-switch-knob" />
        </button>
      </div>
    </>
  );
}
