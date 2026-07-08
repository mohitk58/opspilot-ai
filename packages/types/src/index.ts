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

// ── Project DTOs (Epic 5, minimal MVP surface) ──────────────

export const CreateProjectDto = z.object({
  name: z.string().min(2).max(100),
  key: z
    .string()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Key must be 2-10 chars, uppercase letters/digits, e.g. PAY'),
  description: z.string().max(500).optional(),
});
export type CreateProjectDto = z.infer<typeof CreateProjectDto>;

export const AddProjectMemberDto = z.object({
  userId: z.string().uuid(),
});
export type AddProjectMemberDto = z.infer<typeof AddProjectMemberDto>;

export const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListQuery = z.infer<typeof ListQuery>;

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

export const UpdateIncidentDto = z
  .object({
    title: z.string().min(4).max(200).optional(),
    description: z.string().min(1).max(10_000).optional(),
    severity: IncidentSeverity.optional(),
    assigneeId: z.string().uuid().nullable().optional(), // null = unassign
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');
export type UpdateIncidentDto = z.infer<typeof UpdateIncidentDto>;

export const AddCommentDto = z.object({
  body: z.string().min(1).max(2_000),
});
export type AddCommentDto = z.infer<typeof AddCommentDto>;

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

export const ChangeDeploymentStatusDto = z.object({
  status: z.enum(['IN_PROGRESS', 'SUCCESS', 'FAILED', 'ROLLED_BACK']),
  durationSec: z.number().int().nonnegative().optional(),
});
export type ChangeDeploymentStatusDto = z.infer<typeof ChangeDeploymentStatusDto>;

export const ListDeploymentsQuery = z.object({
  projectId: z.string().uuid().optional(),
  environment: DeploymentEnv.optional(),
  status: DeploymentStatus.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListDeploymentsQuery = z.infer<typeof ListDeploymentsQuery>;

export const CreateApiKeyDto = z.object({
  name: z.string().min(2).max(80),
});
export type CreateApiKeyDto = z.infer<typeof CreateApiKeyDto>;

export interface DeploymentDto {
  id: string;
  projectId: string;
  projectKey: string;
  version: string;
  environment: DeploymentEnv;
  status: DeploymentStatus;
  triggeredBy: string;
  commitSha: string | null;
  durationSec: number | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ApiKeyDto {
  id: string;
  projectId: string;
  name: string;
  /** e.g. "opk_a1b2" — display only; the full key is shown once at creation */
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

/** Returned once, at creation time only. The key is hashed at rest. */
export interface ApiKeyCreatedDto extends ApiKeyDto {
  plaintextKey: string;
}

// ── Incident timeline event payloads ────────────────────────
// One table holds all event types (docs/03 §3); payload integrity is
// enforced here at the application layer, shared by writer and renderer.

export const TimelineEventType = z.enum([
  'CREATED',
  'STATUS_CHANGED',
  'ASSIGNED',
  'COMMENT',
  'LINKED_DEPLOYMENT',
  'SEVERITY_CHANGED',
]);
export type TimelineEventType = z.infer<typeof TimelineEventType>;

export const TIMELINE_PAYLOADS = {
  CREATED: z.object({ severity: IncidentSeverity, title: z.string() }),
  STATUS_CHANGED: z.object({
    from: IncidentStatus,
    to: IncidentStatus,
    comment: z.string().optional(),
  }),
  ASSIGNED: z.object({
    assigneeId: z.string().uuid().nullable(), // null = unassigned
    assigneeName: z.string().nullable(),
  }),
  COMMENT: z.object({ body: z.string() }),
  LINKED_DEPLOYMENT: z.object({
    deploymentId: z.string().uuid(),
    version: z.string().optional(),
    environment: DeploymentEnv.optional(),
  }),
  SEVERITY_CHANGED: z.object({ from: IncidentSeverity, to: IncidentSeverity }),
} satisfies Record<TimelineEventType, z.ZodTypeAny>;

export interface TimelineEventDto {
  id: string;
  type: TimelineEventType;
  payload: unknown; // narrow with TIMELINE_PAYLOADS[type] when rendering
  createdAt: string;
  actor: { id: string; fullName: string };
}

// ── Incident response shapes (API → UI contract) ────────────

export interface UserSummaryDto {
  id: string;
  fullName: string;
  email: string;
}

export interface IncidentDto {
  id: string;
  projectId: string;
  number: number;
  /** e.g. "PAY-42" — project key + per-project number */
  displayNumber: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  createdBy: UserSummaryDto;
  assignee: UserSummaryDto | null;
  /** D4 — "caused by deployment" */
  deployment: { id: string; version: string; environment: DeploymentEnv } | null;
}

// ── Dashboard (Epic 4) ──────────────────────────────────────

export const DashboardQuery = z.object({
  projectId: z.string().uuid().optional(),
});
export type DashboardQuery = z.infer<typeof DashboardQuery>;

export interface TrendPointDto {
  /** ISO date (day precision), e.g. "2026-07-08" */
  day: string;
  count: number;
}

export interface DashboardSummaryDto {
  incidentsByStatus: Record<IncidentStatus, number>;
  /** Open = any non-RESOLVED status (M1) */
  openBySeverity: Record<IncidentSeverity, number>;
  deployments30d: { total: number; succeeded: number; failed: number; successRate: number | null };
  trends: {
    incidentsOpened: TrendPointDto[];
    incidentsResolved: TrendPointDto[];
    deploysSucceeded: TrendPointDto[];
    deploysFailed: TrendPointDto[];
  };
  /** Server time the aggregate was computed (cache may serve it up to 60 s) */
  computedAt: string;
}

export interface ActivityItemDto {
  id: string;
  type: TimelineEventType;
  payload: unknown;
  createdAt: string;
  actor: { id: string; fullName: string };
  incident: { id: string; displayNumber: string; title: string };
}

// ── Shared response envelope ────────────────────────────────

export interface Paginated<T> {
  data: T[];
  meta: { total: number; page: number; pageSize: number };
}
