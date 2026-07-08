'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddCommentDto,
  ChangeIncidentStatusDto,
  CreateIncidentDto,
  IncidentDto,
  IncidentStatus,
  ListIncidentsQuery,
  Paginated,
  TimelineEventDto,
  UpdateIncidentDto,
} from '@opspilot/types';
import { authApi } from '@/lib/api';

export type IncidentFilters = Partial<ListIncidentsQuery>;

function toQueryString(filters: IncidentFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useIncidents(filters: IncidentFilters) {
  return useQuery({
    queryKey: ['incidents', 'list', filters],
    queryFn: () => authApi<Paginated<IncidentDto>>(`/incidents${toQueryString(filters)}`),
    placeholderData: (previous) => previous, // keep the table while filters change
  });
}

const ALL_STATUSES: IncidentStatus[] = [
  'OPEN',
  'INVESTIGATING',
  'IDENTIFIED',
  'MONITORING',
  'RESOLVED',
];

/**
 * Interim dashboard counts derived from the list endpoint (meta.total with
 * pageSize=1). Replaced by the Redis-cached dashboard module (Epic 4).
 */
export function useStatusCounts() {
  return useQuery({
    queryKey: ['incidents', 'counts'],
    queryFn: async () => {
      const entries = await Promise.all(
        ALL_STATUSES.map(async (status) => {
          const res = await authApi<Paginated<IncidentDto>>(
            `/incidents?status=${status}&pageSize=1`,
          );
          return [status, res.meta.total] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<IncidentStatus, number>;
    },
  });
}

export function useIncident(id: string) {
  return useQuery({
    queryKey: ['incidents', 'detail', id],
    queryFn: () => authApi<IncidentDto>(`/incidents/${id}`),
  });
}

export function useTimeline(incidentId: string) {
  return useQuery({
    queryKey: ['incidents', 'detail', incidentId, 'timeline'],
    queryFn: () =>
      authApi<Paginated<TimelineEventDto>>(`/incidents/${incidentId}/timeline?pageSize=100`),
  });
}

export function useCreateIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateIncidentDto) =>
      authApi<IncidentDto>('/incidents', { method: 'POST', body: JSON.stringify(dto) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['incidents', 'list'] }),
  });
}

export function useUpdateIncident(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateIncidentDto) =>
      authApi<IncidentDto>(`/incidents/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['incidents', 'detail', id], updated);
      void queryClient.invalidateQueries({ queryKey: ['incidents'] });
    },
  });
}

/**
 * Optimistic status change (the roadmap's stated pattern): the detail view
 * flips immediately; a 422 from the status machine rolls it back.
 */
export function useChangeStatus(id: string) {
  const queryClient = useQueryClient();
  const detailKey = ['incidents', 'detail', id];
  return useMutation({
    mutationFn: (dto: ChangeIncidentStatusDto) =>
      authApi<IncidentDto>(`/incidents/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify(dto),
      }),
    onMutate: async (dto) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<IncidentDto>(detailKey);
      if (previous) {
        queryClient.setQueryData<IncidentDto>(detailKey, { ...previous, status: dto.status });
      }
      return { previous };
    },
    onError: (_err, _dto, context) => {
      if (context?.previous) queryClient.setQueryData(detailKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['incidents'] }),
  });
}

export function useAddComment(incidentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: AddCommentDto) =>
      authApi<TimelineEventDto>(`/incidents/${incidentId}/comments`, {
        method: 'POST',
        body: JSON.stringify(dto),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['incidents', 'detail', incidentId, 'timeline'],
      }),
  });
}
