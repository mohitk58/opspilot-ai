'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import type { IncidentSeverity, IncidentStatus } from '@opspilot/types';
import { SeverityBadge, StatusBadge } from '@/components/badges';
import { useIncidents, type IncidentFilters } from '@/hooks/use-incidents';
import { useProjects } from '@/hooks/use-projects';
import { useAuth } from '@/lib/auth';

const STATUSES: IncidentStatus[] = [
  'OPEN',
  'INVESTIGATING',
  'IDENTIFIED',
  'MONITORING',
  'RESOLVED',
];
const SEVERITIES: IncidentSeverity[] = ['SEV1', 'SEV2', 'SEV3', 'SEV4'];

const selectClass =
  'rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-emerald-500';

export default function IncidentsPage() {
  return (
    // useSearchParams requires a Suspense boundary on statically prerendered pages
    <Suspense fallback={null}>
      <IncidentsView />
    </Suspense>
  );
}

function IncidentsView() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<IncidentFilters>(() => {
    const status = searchParams.get('status') as IncidentStatus | null;
    return {
      page: 1,
      pageSize: 25,
      status: status && STATUSES.includes(status) ? status : undefined, // dashboard tiles deep-link here
      projectId: searchParams.get('projectId') ?? undefined,
    };
  });
  const { data, isPending, error } = useIncidents(filters);
  const { data: projects } = useProjects();
  const canWrite = user?.role !== 'VIEWER';

  function setFilter(patch: IncidentFilters) {
    setFilters((prev) => ({ ...prev, ...patch, page: 1 })); // filters reset paging
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.meta.total / data.meta.pageSize)) : 1;
  const page = filters.page ?? 1;

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Incidents</h1>
          <p className="mt-1 text-sm text-slate-400">
            {data ? `${data.meta.total} matching` : 'Loading…'}
          </p>
        </div>
        {canWrite && (
          <Link
            href="/incidents/new"
            className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400"
          >
            New incident
          </Link>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search titles…"
          className={`${selectClass} w-56`}
          onChange={(e) => setFilter({ q: e.target.value || undefined })}
        />
        <select
          className={selectClass}
          value={filters.status ?? ''}
          onChange={(e) =>
            setFilter({ status: (e.target.value || undefined) as IncidentStatus | undefined })
          }
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          value={filters.severity ?? ''}
          onChange={(e) =>
            setFilter({
              severity: (e.target.value || undefined) as IncidentSeverity | undefined,
            })
          }
        >
          <option value="">All severities</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          value={filters.projectId ?? ''}
          onChange={(e) => setFilter({ projectId: e.target.value || undefined })}
        >
          <option value="">All projects</option>
          {projects?.data.map((p) => (
            <option key={p.id} value={p.id}>
              {p.key} — {p.name}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="mt-6 text-sm text-red-400">{error.message}</p>}

      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Assignee</th>
              <th className="px-4 py-3">Opened</th>
            </tr>
          </thead>
          <tbody>
            {data?.data.map((incident) => (
              <tr key={incident.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-900/50">
                <td className="px-4 py-3 font-mono text-slate-400">{incident.displayNumber}</td>
                <td className="px-4 py-3">
                  <Link href={`/incidents/${incident.id}`} className="hover:text-emerald-400">
                    {incident.title}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <SeverityBadge severity={incident.severity} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={incident.status} />
                </td>
                <td className="px-4 py-3 text-slate-400">
                  {incident.assignee?.fullName ?? '—'}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {new Date(incident.createdAt).toLocaleString()}
                </td>
              </tr>
            ))}
            {!isPending && data?.data.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  No incidents match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-end gap-3 text-sm text-slate-400">
        <button
          disabled={page <= 1}
          onClick={() => setFilters((f) => ({ ...f, page: page - 1 }))}
          className="rounded-md border border-slate-700 px-3 py-1.5 hover:border-slate-500 disabled:opacity-40"
        >
          Previous
        </button>
        <span>
          Page {page} of {totalPages}
        </span>
        <button
          disabled={page >= totalPages}
          onClick={() => setFilters((f) => ({ ...f, page: page + 1 }))}
          className="rounded-md border border-slate-700 px-3 py-1.5 hover:border-slate-500 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </main>
  );
}
