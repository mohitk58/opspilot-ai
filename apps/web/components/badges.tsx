import type {
  DeploymentEnv,
  DeploymentStatus,
  IncidentSeverity,
  IncidentStatus,
} from '@opspilot/types';

const SEVERITY_STYLES: Record<IncidentSeverity, string> = {
  SEV1: 'border-red-800 bg-red-950/60 text-red-400',
  SEV2: 'border-orange-800 bg-orange-950/60 text-orange-400',
  SEV3: 'border-yellow-800 bg-yellow-950/60 text-yellow-400',
  SEV4: 'border-slate-700 bg-slate-900 text-slate-400',
};

const STATUS_STYLES: Record<IncidentStatus, string> = {
  OPEN: 'border-red-800 bg-red-950/60 text-red-400',
  INVESTIGATING: 'border-amber-800 bg-amber-950/60 text-amber-400',
  IDENTIFIED: 'border-sky-800 bg-sky-950/60 text-sky-400',
  MONITORING: 'border-violet-800 bg-violet-950/60 text-violet-400',
  RESOLVED: 'border-emerald-800 bg-emerald-950/60 text-emerald-400',
};

const badgeBase =
  'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wider';

export function SeverityBadge({ severity }: { severity: IncidentSeverity }) {
  return <span className={`${badgeBase} ${SEVERITY_STYLES[severity]}`}>{severity}</span>;
}

export function StatusBadge({ status }: { status: IncidentStatus }) {
  return (
    <span className={`${badgeBase} ${STATUS_STYLES[status]}`}>{status.toLowerCase()}</span>
  );
}

const ENV_STYLES: Record<DeploymentEnv, string> = {
  DEV: 'border-slate-700 bg-slate-900 text-slate-400',
  STAGING: 'border-sky-800 bg-sky-950/60 text-sky-400',
  PRODUCTION: 'border-violet-800 bg-violet-950/60 text-violet-400',
};

const DEPLOY_STATUS_STYLES: Record<DeploymentStatus, string> = {
  PENDING: 'border-slate-700 bg-slate-900 text-slate-400',
  IN_PROGRESS: 'border-amber-800 bg-amber-950/60 text-amber-400',
  SUCCESS: 'border-emerald-800 bg-emerald-950/60 text-emerald-400',
  FAILED: 'border-red-800 bg-red-950/60 text-red-400',
  ROLLED_BACK: 'border-orange-800 bg-orange-950/60 text-orange-400',
};

export function EnvBadge({ env }: { env: DeploymentEnv }) {
  return <span className={`${badgeBase} ${ENV_STYLES[env]}`}>{env.toLowerCase()}</span>;
}

export function DeployStatusBadge({ status }: { status: DeploymentStatus }) {
  return (
    <span className={`${badgeBase} ${DEPLOY_STATUS_STYLES[status]}`}>
      {status.replace('_', ' ').toLowerCase()}
    </span>
  );
}
