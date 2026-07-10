'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateProjectDto, Paginated } from '@opspilot/types';
import { authApi } from '@/lib/api';

export interface Project {
  id: string;
  name: string;
  key: string;
  description: string | null;
  createdAt: string;
  members: { userId: string }[];
}

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => authApi<Paginated<Project>>('/projects?pageSize=100'),
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateProjectDto) =>
      authApi<Project>('/projects', { method: 'POST', body: JSON.stringify(dto) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });
}
