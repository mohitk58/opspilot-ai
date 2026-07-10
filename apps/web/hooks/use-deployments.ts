'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DeploymentDto,
  ListDeploymentsQuery,
  Paginated,
  RecordDeploymentDto,
} from '@opspilot/types';
import { authApi } from '@/lib/api';

export type DeploymentFilters = Partial<ListDeploymentsQuery>;

function toQueryString(filters: DeploymentFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useDeployments(filters: DeploymentFilters) {
  return useQuery({
    queryKey: ['deployments', 'list', filters],
    queryFn: () => authApi<Paginated<DeploymentDto>>(`/deployments${toQueryString(filters)}`),
    placeholderData: (previous) => previous,
  });
}

export function useRecordDeployment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: RecordDeploymentDto) =>
      authApi<DeploymentDto>('/deployments', { method: 'POST', body: JSON.stringify(dto) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deployments'] }),
  });
}
