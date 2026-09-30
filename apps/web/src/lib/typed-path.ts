import { headers } from 'next/headers';

// The path as the visitor typed it, forwarded by src/proxy.ts (which overwrites any value a
// client sends). Routing itself uses the lower-cased path.
export const TYPED_PATHNAME_HEADER = 'x-runtruck-typed-pathname';

// Runtruck1's index routes navigated relative to the URL as typed: '/app/Fleet' went to
// '/app/Fleet/drivers', '/APP' to '/APP/dashboard' and '/app/fleet/' to '/app/fleet/drivers'.
// `target` is the canonical destination under `sectionPath`; its prefix is replaced by the
// typed one when the typed path is that section in another case. Anything else keeps `target`.
export function underTypedPath(typed: string, sectionPath: string, target: string): string {
  const base = typed.length > 1 ? typed.replace(/\/$/, '') : typed;
  if (base.toLowerCase() !== sectionPath || !target.startsWith(`${sectionPath}/`)) return target;
  return base + target.slice(sectionPath.length);
}

// The redirect target of a section root page (server components only).
export async function sectionRedirectTarget(sectionPath: string, target: string): Promise<string> {
  return underTypedPath((await headers()).get(TYPED_PATHNAME_HEADER) ?? '', sectionPath, target);
}
