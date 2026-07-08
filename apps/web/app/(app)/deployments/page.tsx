'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  RecordDeploymentDto,
  type DeploymentEnv,
  type DeploymentStatus,
} from '@opspilot/types';
import { DeployStatusBadge, EnvBadge } from '@/components/badges';
import { FormError, SubmitButton, TextField } from '@/components/form';
import { useDeployments, useRecordDeployment, type DeploymentFilters } from '@/hooks/use-deployments';
import { useProjects } from '@/hooks/use-projects';
import { useAuth } from '@/lib/auth';

const ENVS: DeploymentEnv[] = ['DEV', 'STAGING', 'PRODUCTION'];
const STATUSES: DeploymentStatus[] = ['PENDING', 'IN_PROGRESS', 'SUCCESS', 'FAILED', 'ROLLED_BACK'];

const selectClass =
  'rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-emerald-500';

export default function DeploymentsPage() {
  const { user } = useAuth();
  const [filters, setFilters] = useState<DeploymentFilters>({ page: 1, pageSize: 25 });
  const [showForm, setShowForm] = useState(false);
  const { data, isPending, error } = useDeployments(filters);
  const { data: projects } = useProjects();
  const canWrite = user?.role !== 'VIEWER';

  function setFilter(patch: DeploymentFilters) {
    setFilters((prev) => ({ ...prev, ...patch, page: 1 }));
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.meta.total / data.meta.pageSize)) : 1;
  const page = filters.page ?? 1;

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Deployments</h1>
          <p className="mt-1 text-sm text-slate-400">
            {data ? `${data.meta.total} recorded` : 'Loading…'} — CI pushes here via{' '}
            <code className="rounded bg-slate-900 px-1.5 py-0.5 text-xs">X-API-Key</code>
          </p>
        </div>
        {canWrite && (
          <button
            onClick={() => setShowForm((s) => !s)}
            className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400"
          >
            {showForm ? 'Close' : 'Record deployment'}
          </button>
        )}
      </div>

      {showForm && <RecordForm onDone={() => setShowForm(false)} />}

      <div className="mt-6 flex flex-wrap items-center gap-3">
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
        <select
          className={selectClass}
          value={filters.environment ?? ''}
          onChange={(e) =>
            setFilter({ environment: (e.target.value || undefined) as DeploymentEnv | undefined })
          }
        >
          <option value="">All environments</option>
          {ENVS.map((env) => (
            <option key={env} value={env}>
              {env}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          value={filters.status ?? ''}
          onChange={(e) =>
            setFilter({ status: (e.target.value || undefined) as DeploymentStatus | undefined })
          }
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="mt-6 text-sm text-red-400">{error.message}</p>}

      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Project</th>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3">Environment</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Triggered by</th>
              <th className="px-4 py-3">Started</th>
              <th className="px-4 py-3">Duration</th>
            </tr>
          </thead>
          <tbody>
            {data?.data.map((d) => (
              <tr key={d.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-900/50">
                <td className="px-4 py-3 font-mono text-slate-400">{d.projectKey}</td>
                <td className="px-4 py-3 font-mono">{d.version}</td>
                <td className="px-4 py-3"><EnvBadge env={d.environment} /></td>
                <td className="px-4 py-3"><DeployStatusBadge status={d.status} /></td>
                <td className="px-4 py-3 text-slate-400">{d.triggeredBy}</td>
                <td className="px-4 py-3 text-slate-500">{new Date(d.startedAt).toLocaleString()}</td>
                <td className="px-4 py-3 text-slate-500">
                  {d.durationSec != null ? `${d.durationSec}s` : '—'}
                </td>
              </tr>
            ))}
            {!isPending && data?.data.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                  No deployments match these filters.
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

function RecordForm({ onDone }: { onDone: () => void }) {
  const record = useRecordDeployment();
  const { data: projects } = useProjects();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RecordDeploymentDto>({ resolver: zodResolver(RecordDeploymentDto) });

  const onSubmit = handleSubmit(async (dto) => {
    setServerError(null);
    try {
      await record.mutateAsync(dto);
      onDone();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  });

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="mt-6 grid items-start gap-4 rounded-lg border border-slate-800 p-5 sm:grid-cols-2 lg:grid-cols-4"
    >
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-slate-300">Project</span>
        <select className={selectClass} {...register('projectId')}>
          <option value="">Select…</option>
          {projects?.data.map((p) => (
            <option key={p.id} value={p.id}>
              {p.key} — {p.name}
            </option>
          ))}
        </select>
        {errors.projectId && <span className="text-xs text-red-400">Choose a project</span>}
      </label>
      <TextField label="Version" placeholder="v2.14.0" registration={register('version')} error={errors.version} />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-slate-300">Environment</span>
        <select className={selectClass} {...register('environment')}>
          <option value="">Select…</option>
          {ENVS.map((env) => (
            <option key={env} value={env}>
              {env}
            </option>
          ))}
        </select>
        {errors.environment && <span className="text-xs text-red-400">Choose an environment</span>}
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-slate-300">Status</span>
        <select className={selectClass} {...register('status')}>
          <option value="">Select…</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {errors.status && <span className="text-xs text-red-400">Choose a status</span>}
      </label>
      <div className="sm:col-span-2 lg:col-span-4 flex items-center gap-4">
        <SubmitButton pending={isSubmitting}>Record</SubmitButton>
        <FormError message={serverError} />
      </div>
    </form>
  );
}
