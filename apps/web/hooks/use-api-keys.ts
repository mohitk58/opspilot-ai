'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiKeyCreatedDto, ApiKeyDto, CreateApiKeyDto } from '@opspilot/types';
import { authApi } from '@/lib/api';

export function useApiKeys(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['api-keys', projectId],
    queryFn: () => authApi<ApiKeyDto[]>(`/projects/${projectId}/api-keys`),
    enabled,
  });
}

export function useCreateApiKey(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateApiKeyDto) =>
      authApi<ApiKeyCreatedDto>(`/projects/${projectId}/api-keys`, {
        method: 'POST',
        body: JSON.stringify(dto),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys', projectId] }),
  });
}

export function useRevokeApiKey(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (keyId: string) => authApi<void>(`/api-keys/${keyId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys', projectId] }),
  });
}
