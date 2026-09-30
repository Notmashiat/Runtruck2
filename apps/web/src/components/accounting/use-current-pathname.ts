'use client';

import { usePathname } from 'next/navigation';

// lib/api/billing.ts is imported by server components (the /app layout and the accounting
// pages) for its query definitions, and next/navigation's hooks may not be imported into
// the server graph. Its client hooks therefore read the pathname through this client module.
export function useCurrentPathname(): string {
  return usePathname();
}
