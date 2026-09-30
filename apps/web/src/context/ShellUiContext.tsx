'use client';

import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

// Client-side presentation state shared across the /app shell (Runtruck1's
// AppShellContext minus its business data, which now lives in the API):
// the top-bar search text and the remembered filter pills.
export type LoadTab = 'Active' | 'Needs POD' | 'Delivered' | 'All';
export type DriverTab = 'All' | 'On duty' | 'Available';

interface ShellUiState {
  query: string;
  setQuery: (q: string) => void;
  loadTab: LoadTab;
  setLoadTab: (t: LoadTab) => void;
  driverTab: DriverTab;
  setDriverTab: (t: DriverTab) => void;
}

const ShellUiContext = createContext<ShellUiState | null>(null);

export function ShellUiProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState('');
  const [loadTab, setLoadTab] = useState<LoadTab>('Active');
  const [driverTab, setDriverTab] = useState<DriverTab>('All');
  const value = useMemo(() => ({ query, setQuery, loadTab, setLoadTab, driverTab, setDriverTab }), [query, loadTab, driverTab]);
  return <ShellUiContext.Provider value={value}>{children}</ShellUiContext.Provider>;
}

export function useShellUi(): ShellUiState {
  const ctx = useContext(ShellUiContext);
  if (!ctx) throw new Error('useShellUi must be used within ShellUiProvider');
  return ctx;
}
