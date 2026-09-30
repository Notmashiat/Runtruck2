'use client';

import type { MeResponse } from '@runtruck/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { ApiError } from '@/lib/api/client';
import { SessionProvider } from '@/context/SessionContext';
import { ShellUiProvider } from '@/context/ShellUiContext';

export function AppProviders({ me, children }: { me: MeResponse; children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // Don't hammer the API with retries for errors that won't change.
            retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider me={me}>
        <ShellUiProvider>{children}</ShellUiProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
