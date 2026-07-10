'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListNotificationsQuery, NotificationDto, Paginated } from '@opspilot/types';
import { authApi } from '@/lib/api';

type NotificationList = Paginated<NotificationDto> & { unreadCount: number };

export function useNotifications(query: Partial<ListNotificationsQuery> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return useQuery({
    queryKey: ['notifications', query],
    queryFn: () => authApi<NotificationList>(`/notifications${qs ? `?${qs}` : ''}`),
    // Poll (SSE/websockets are out of MVP scope). intervalInBackground matters:
    // by default TanStack pauses the interval while the window is unfocused,
    // so a bell in an idle window would only update on reload.
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authApi<void>(`/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => authApi<{ marked: number }>('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
