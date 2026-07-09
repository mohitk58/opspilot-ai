'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';

export function Providers({ children }: { children: React.ReactNode }) {
  // One client per browser tab, created lazily so it never leaks across
  // server-rendered requests.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
      }),
  );

  // The cache belongs to a user session: without this, switching accounts in
  // the same tab serves the previous user's cached queries on first render
  // (empty bell, stale lists) until the next poll corrects them.
  const userId = useAuth((s) => s.user?.id);
  const previousUserId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (previousUserId.current !== undefined && previousUserId.current !== userId) {
      client.clear();
    }
    previousUserId.current = userId;
  }, [userId, client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
