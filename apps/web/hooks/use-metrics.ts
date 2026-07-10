'use client';

import { useQuery } from '@tanstack/react-query';
import type { MetricSeriesDto } from '@opspilot/types';
import { authApi } from '@/lib/api';

/** M3 — last hour by default; the simulator writes every 15 s. */
export function useSystemMetrics(projectId?: string) {
  return useQuery({
    queryKey: ['metrics', 'system', projectId ?? 'org'],
    queryFn: () =>
      authApi<MetricSeriesDto[]>(
        `/metrics/system${projectId ? `?projectId=${projectId}` : ''}`,
      ),
    refetchInterval: 30_000,
    placeholderData: (previous) => previous,
  });
}
