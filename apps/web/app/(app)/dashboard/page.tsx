'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TIMELINE_PAYLOADS,
  type ActivityItemDto,
  type IncidentSeverity,
} from '@opspilot/types';
import { SeverityBadge, StatusBadge } from '@/components/badges';
import { DeployTrendChart, IncidentTrendChart, MetricChart } from '@/components/trend-charts';
import { useDashboardActivity, useDashboardSummary } from '@/hooks/use-dashboard';
import { useSystemMetrics } from '@/hooks/use-metrics';
import { useProjects } from '@/hooks/use-projects';
import { api } from '@/lib/api';

interface Health {
  status: string;
  database: string;
  uptimeSec: number;
}

const SEVERITIES: IncidentSeverity[] = ['SEV1', 'SEV2', 'SEV3', 'SEV4'];

export default function DashboardPage() {
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const { data: summary } = useDashboardSummary(projectId);
  const { data: activity } = useDashboardActivity(projectId);
  const { data: projects } = useProjects();
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api<Health>('/health'),
    refetchInterval: 30_000,
  });

  const openTotal = summary
    ? Object.values(summary.openBySeverity).reduce((a, b) => a + b, 0)
    : null;

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Operations dashboard</h1>
        <select
          value={projectId ?? ''}
          onChange={(e) => setProjectId(e.target.value || undefined)}
          className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-emerald-500"
        >
          <option value="">All projects</option>
          {projects?.data.map((p) => (
            <option key={p.id} value={p.id}>
              {p.key} — {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* M1: open incidents by severity · M2: 30-day success rate */}
      <section className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Open incidents" value={openTotal} href={`/incidents${projectId ? `?projectId=${projectId}` : ''}`} />
        {SEVERITIES.map((sev) => (
          <div key={sev} className="rounded-lg border border-slate-800 p-4">
            <p className="text-3xl font-semibold tabular-nums text-slate-100">
              {summary ? summary.openBySeverity[sev] : '—'}
            </p>
            <p className="mt-1"><SeverityBadge severity={sev} /></p>
          </div>
        ))}
        <div className="rounded-lg border border-slate-800 p-4">
          <p className="text-3xl font-semibold tabular-nums text-slate-100">
            {summary
              ? summary.deployments30d.successRate !== null
                ? `${summary.deployments30d.successRate}%`
                : '—'
              : '—'}
          </p>
          <p className="mt-1 text-xs uppercase tracking-wider text-slate-500">
            Deploy success · 30d ({summary?.deployments30d.total ?? 0})
          </p>
        </div>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <IncidentTrendChart
          opened={summary?.trends.incidentsOpened ?? []}
          resolved={summary?.trends.incidentsResolved ?? []}
        />
        <DeployTrendChart
          succeeded={summary?.trends.deploysSucceeded ?? []}
          failed={summary?.trends.deploysFailed ?? []}
        />
      </section>

      <SystemMetricsSection projectId={projectId} />

      {/* M4: recent activity across projects */}
      <section className="mt-10">
        <h2 className="text-sm uppercase tracking-wider text-slate-500">Recent activity</h2>
        <ol className="mt-3 flex flex-col gap-1 rounded-lg border border-slate-800 p-2">
          {activity?.map((item) => <ActivityRow key={item.id} item={item} />)}
          {activity && activity.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-slate-500">
              No activity yet — create an incident to get things moving.
            </li>
          )}
        </ol>
      </section>

      <section className="mt-10 rounded-lg border border-slate-800 p-6">
        <h2 className="text-sm uppercase tracking-wider text-slate-500">API status</h2>
        {health ? (
          <p className="mt-2 text-sm text-emerald-400">
            {health.status} — database {health.database}, up {health.uptimeSec}s
            {summary && (
              <span className="text-slate-500">
                {' '}· aggregates computed {new Date(summary.computedAt).toLocaleTimeString()}
              </span>
            )}
          </p>
        ) : (
          <p className="mt-2 text-sm text-amber-400">
            API unreachable. Start it with{' '}
            <code className="rounded bg-slate-900 px-1.5 py-0.5">npm run dev:api</code>
          </p>
        )}
      </section>
    </main>
  );
}

/** M3 — simulated telemetry (last hour, 15 s cadence) until real ingestion. */
function SystemMetricsSection({ projectId }: { projectId?: string }) {
  const { data: series } = useSystemMetrics(projectId);
  if (!series || series.length === 0) {
    return (
      <section className="mt-6 rounded-lg border border-slate-800 p-5 text-sm text-slate-500">
        System metrics appear here once the workers process is running (
        <code className="rounded bg-slate-900 px-1.5 py-0.5 text-xs">npm run dev:workers</code>
        ) — the simulator writes latency and error-rate samples every 15 s.
      </section>
    );
  }
  return (
    <section className="mt-6 grid gap-4 lg:grid-cols-2">
      <MetricChart
        title="API latency p95 (ms) — last hour, simulated"
        series={series.filter((s) => s.metric === 'latency_p95_ms')}
      />
      <MetricChart
        title="Error rate (%) — last hour, simulated"
        series={series.filter((s) => s.metric === 'error_rate')}
      />
    </section>
  );
}

function Tile({ label, value, href }: { label: string; value: number | null; href: string }) {
  return (
    <Link href={href} className="rounded-lg border border-slate-800 p-4 hover:border-slate-600">
      <p className="text-3xl font-semibold tabular-nums text-slate-100">{value ?? '—'}</p>
      <p className="mt-1 text-xs uppercase tracking-wider text-slate-500">{label}</p>
    </Link>
  );
}

function activityText(item: ActivityItemDto): React.ReactNode {
  switch (item.type) {
    case 'CREATED':
      return 'opened this incident';
    case 'STATUS_CHANGED': {
      const p = TIMELINE_PAYLOADS.STATUS_CHANGED.safeParse(item.payload);
      return p.success ? (
        <span className="inline-flex items-center gap-1.5">
          moved <StatusBadge status={p.data.from} /> → <StatusBadge status={p.data.to} />
        </span>
      ) : (
        'changed status'
      );
    }
    case 'ASSIGNED':
      return 'changed the assignee';
    case 'COMMENT':
      return 'commented';
    case 'LINKED_DEPLOYMENT':
      return 'linked a deployment';
    case 'SEVERITY_CHANGED':
      return 'changed severity';
    default:
      return item.type;
  }
}

function ActivityRow({ item }: { item: ActivityItemDto }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 rounded px-3 py-2 text-sm hover:bg-slate-900/60">
      <span className="text-slate-300">{item.actor.fullName}</span>
      <span className="text-slate-400">{activityText(item)}</span>
      <Link
        href={`/incidents/${item.incident.id}`}
        className="font-mono text-xs text-emerald-400 hover:underline"
      >
        {item.incident.displayNumber}
      </Link>
      <span className="truncate text-slate-500">{item.incident.title}</span>
      <span className="ml-auto text-xs text-slate-600">
        {new Date(item.createdAt).toLocaleString()}
      </span>
    </li>
  );
}
