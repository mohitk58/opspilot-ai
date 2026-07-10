'use client';

import { useQuery } from '@tanstack/react-query';
import type { ActivityItemDto, DashboardSummaryDto } from '@opspilot/types';
import { authApi } from '@/lib/api';

const qs = (projectId?: string) => (projectId ? `?projectId=${projectId}` : '');

export function useDashboardSummary(projectId?: string) {
  return useQuery({
    queryKey: ['dashboard', 'summary', projectId ?? 'org'],
    queryFn: () => authApi<DashboardSummaryDto>(`/dashboard/summary${qs(projectId)}`),
    refetchInterval: 60_000, // matches the server-side cache TTL
    placeholderData: (previous) => previous,
  });
}

export function useDashboardActivity(projectId?: string) {
  return useQuery({
    queryKey: ['dashboard', 'activity', projectId ?? 'org'],
    queryFn: () => authApi<ActivityItemDto[]>(`/dashboard/activity${qs(projectId)}`),
    refetchInterval: 30_000,
    placeholderData: (previous) => previous,
  });
}
