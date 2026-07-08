'use client';

import { useQuery } from '@tanstack/react-query';
import type { Paginated, Role } from '@opspilot/types';
import { authApi } from '@/lib/api';

export interface OrgUser {
  id: string;
  fullName: string;
  email: string;
  role: Role;
}

/** Org directory for assignee/member pickers. */
export function useOrgUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => authApi<Paginated<OrgUser>>('/users'),
    staleTime: 5 * 60_000, // directory churns slowly
  });
}
