'use client';

import { hasPermissions, type Permission } from '@runtruck/permissions';
import type { MeResponse } from '@runtruck/types';
import { createContext, type ReactNode, useContext, useMemo } from 'react';

interface SessionValue {
  me: MeResponse;
  // Hides controls the API would refuse. Never a security boundary (architecture §2 Rule 2).
  can: (...permissions: Permission[]) => boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ me, children }: { me: MeResponse; children: ReactNode }) {
  const value = useMemo<SessionValue>(() => {
    const granted = new Set(me.permissions);
    return { me, can: (...permissions) => hasPermissions(granted, permissions) };
  }, [me]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
