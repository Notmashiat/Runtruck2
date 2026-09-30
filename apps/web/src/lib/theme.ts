// Light or dark for the whole site. The choice is kept in localStorage and
// applied as data-theme on <html>, which shell.css (the app) and app.css (the
// marketing site) key their colour tokens off. The root layout's inline script
// applies a saved theme before first paint. Device preference, not business data.
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'runtruck-theme';

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private mode or blocked storage: the choice just lasts for this visit.
  }
}
