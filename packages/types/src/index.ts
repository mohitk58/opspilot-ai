import { z } from 'zod';

// ── Enums (mirror prisma/schema.prisma) ─────────────────────

export const Role = z.enum(['ADMIN', 'ENGINEER', 'VIEWER']);
export type Role = z.infer<typeof Role>;

export const IncidentSeverity = z.enum(['SEV1', 'SEV2', 'SEV3', 'SEV4']);
export type IncidentSeverity = z.infer<typeof IncidentSeverity>;

export const IncidentStatus = z.enum([
  'OPEN',
  'INVESTIGATING',
  'IDENTIFIED',
  'MONITORING',
  'RESOLVED',
]);
export type IncidentStatus = z.infer<typeof IncidentStatus>;

export const DeploymentEnv = z.enum(['DEV', 'STAGING', 'PRODUCTION']);
export type DeploymentEnv = z.infer<typeof DeploymentEnv>;

export const DeploymentStatus = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'SUCCESS',
  'FAILED',
  'ROLLED_BACK',
]);
export type DeploymentStatus = z.infer<typeof DeploymentStatus>;

// ── Valid incident status transitions (single source of truth) ──

export const INCIDENT_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  OPEN: ['INVESTIGATING', 'RESOLVED'],
  INVESTIGATING: ['IDENTIFIED', 'OPEN'],
  IDENTIFIED: ['MONITORING', 'INVESTIGATING'],
  MONITORING: ['RESOLVED', 'INVESTIGATING'],
  RESOLVED: [], // reopen intentionally not allowed in MVP — create a new incident
};

// ── Auth DTOs ───────────────────────────────────────────────

export const SignupDto = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(2).max(120),
});
export type SignupDto = z.infer<typeof SignupDto>;

export const LoginDto = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginDto = z.infer<typeof LoginDto>;

export const UpdateUserRoleDto = z.object({
  role: Role,
});
export type UpdateUserRoleDto = z.infer<typeof UpdateUserRoleDto>;

// Safe user shape returned by the API — never includes passwordHash.
export const AuthUserDto = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  role: Role,
  organizationId: z.string().uuid(),
  avatarUrl: z.string().nullable().optional(),
  lastLoginAt: z.coerce.date().nullable().optional(),
});
export type AuthUserDto = z.infer<typeof AuthUserDto>;

export interface AuthResponse {
  user: AuthUserDto;
  accessToken: string;
}

// ── Incident DTOs ───────────────────────────────────────────

export const CreateIncidentDto = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(4).max(200),
  description: z.string().min(1).max(10_000),
  severity: IncidentSeverity,
  assigneeId: z.string().uuid().optional(),
  deploymentId: z.string().uuid().optional(),
});
export type CreateIncidentDto = z.infer<typeof CreateIncidentDto>;

export const ChangeIncidentStatusDto = z.object({
  status: IncidentStatus,
  comment: z.string().max(2_000).optional(),
});
export type ChangeIncidentStatusDto = z.infer<typeof ChangeIncidentStatusDto>;

export const ListIncidentsQuery = z.object({
  projectId: z.string().uuid().optional(),
  status: IncidentStatus.optional(),
  severity: IncidentSeverity.optional(),
  assigneeId: z.string().uuid().optional(),
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListIncidentsQuery = z.infer<typeof ListIncidentsQuery>;

// ── Deployment DTOs ─────────────────────────────────────────

export const RecordDeploymentDto = z.object({
  projectId: z.string().uuid(),
  version: z.string().min(1).max(100),
  environment: DeploymentEnv,
  status: DeploymentStatus,
  commitSha: z.string().max(64).optional(),
  durationSec: z.number().int().nonnegative().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type RecordDeploymentDto = z.infer<typeof RecordDeploymentDto>;

// ── Shared response envelope ────────────────────────────────

export interface Paginated<T> {
  data: T[];
  meta: { total: number; page: number; pageSize: number };
}
