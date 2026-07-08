'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { IncidentStatus } from '@opspilot/types';
import { SeverityBadge, StatusBadge } from '@/components/badges';
import { useIncidents, useStatusCounts } from '@/hooks/use-incidents';
import { useProjects } from '@/hooks/use-projects';
import { api } from '@/lib/api';

interface Health {
  status: string;
  database: string;
  uptimeSec: number;
}

const TILES: { status: IncidentStatus; label: string }[] = [
  { status: 'OPEN', label: 'Open' },
  { status: 'INVESTIGATING', label: 'Investigating' },
  { status: 'IDENTIFIED', label: 'Identified' },
  { status: 'MONITORING', label: 'Monitoring' },
  { status: 'RESOLVED', label: 'Resolved' },
];

/**
 * Interim dashboard over the incidents/projects APIs. The Redis-cached
 * aggregate endpoint (Epic 4) replaces the client-side counts here.
 */
export default function DashboardPage() {
  const { data: counts } = useStatusCounts();
  const { data: recent } = useIncidents({ page: 1, pageSize: 5 });
  const { data: projects } = useProjects();
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api<Health>('/health'),
    refetchInterval: 30_000,
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="text-2xl font-semibold">Operations dashboard</h1>

      <section className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {TILES.map(({ status, label }) => (
          <Link
            key={status}
            href={`/incidents?status=${status}`}
            className="rounded-lg border border-slate-800 p-4 hover:border-slate-600"
          >
            <p className="text-3xl font-semibold tabular-nums text-slate-100">
              {counts ? counts[status] : '—'}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
              <StatusBadge status={status} />
            </p>
            <span className="sr-only">{label} incidents</span>
          </Link>
        ))}
        <Link
          href="/projects"
          className="rounded-lg border border-slate-800 p-4 hover:border-slate-600"
        >
          <p className="text-3xl font-semibold tabular-nums text-slate-100">
            {projects ? projects.meta.total : '—'}
          </p>
          <p className="mt-1 text-xs uppercase tracking-wider text-slate-500">Projects</p>
        </Link>
      </section>

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-sm uppercase tracking-wider text-slate-500">Recent incidents</h2>
          <Link href="/incidents" className="text-sm text-emerald-400 hover:underline">
            View all
          </Link>
        </div>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-left text-sm">
            <tbody>
              {recent?.data.map((incident) => (
                <tr key={incident.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-900/50">
                  <td className="px-4 py-3 font-mono text-slate-400">{incident.displayNumber}</td>
                  <td className="px-4 py-3">
                    <Link href={`/incidents/${incident.id}`} className="hover:text-emerald-400">
                      {incident.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3"><SeverityBadge severity={incident.severity} /></td>
                  <td className="px-4 py-3"><StatusBadge status={incident.status} /></td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(incident.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
              {recent && recent.data.length === 0 && (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-500">
                    No incidents yet — that&apos;s a good day.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10 rounded-lg border border-slate-800 p-6">
        <h2 className="text-sm uppercase tracking-wider text-slate-500">API status</h2>
        {health ? (
          <p className="mt-2 text-sm text-emerald-400">
            {health.status} — database {health.database}, up {health.uptimeSec}s
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
