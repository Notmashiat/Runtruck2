// Applies a saved dark theme before first paint (Runtruck1 index.html did the same). The root
// layout inlines it; the Content-Security-Policy allows it by its SHA-256 hash (lib/csp.ts), so
// any change to this text changes the hash with it.
export const THEME_SCRIPT = `try{document.documentElement.dataset.theme=localStorage.getItem('runtruck-theme')==='dark'?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}`;
