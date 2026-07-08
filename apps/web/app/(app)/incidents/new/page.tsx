'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { CreateIncidentDto } from '@opspilot/types';
import { FormError, SubmitButton, TextField } from '@/components/form';
import { useDeployments } from '@/hooks/use-deployments';
import { useCreateIncident } from '@/hooks/use-incidents';
import { useProjects } from '@/hooks/use-projects';
import { useOrgUsers } from '@/hooks/use-users';

const selectClass =
  'rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500';

export default function NewIncidentPage() {
  const router = useRouter();
  const createIncident = useCreateIncident();
  const { data: projects } = useProjects();
  const { data: users } = useOrgUsers();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateIncidentDto>({ resolver: zodResolver(CreateIncidentDto) });

  // D4 — offer recent deployments of the selected project as the cause
  const projectId = watch('projectId');
  const { data: deployments } = useDeployments(
    projectId ? { projectId, pageSize: 25 } : { pageSize: 1 },
  );

  const onSubmit = handleSubmit(async (dto) => {
    setServerError(null);
    try {
      const incident = await createIncident.mutateAsync({
        ...dto,
        assigneeId: dto.assigneeId || undefined, // '' from "Unassigned" fails the uuid check
        deploymentId: dto.deploymentId || undefined,
      });
      router.replace(`/incidents/${incident.id}`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  });

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold">New incident</h1>

      <form onSubmit={onSubmit} noValidate className="mt-8 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-slate-300">Project</span>
          <select className={selectClass} {...register('projectId')}>
            <option value="">Select a project…</option>
            {projects?.data.map((p) => (
              <option key={p.id} value={p.id}>
                {p.key} — {p.name}
              </option>
            ))}
          </select>
          {errors.projectId && (
            <span className="text-xs text-red-400">Choose a project</span>
          )}
        </label>

        <TextField
          label="Title"
          placeholder="Checkout latency spike in eu-west-1"
          registration={register('title')}
          error={errors.title}
        />

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-slate-300">Description</span>
          <textarea
            rows={5}
            placeholder="What is broken, since when, observed impact…"
            className={selectClass}
            {...register('description')}
          />
          {errors.description && (
            <span className="text-xs text-red-400">{errors.description.message}</span>
          )}
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-slate-300">Severity</span>
            <select className={selectClass} {...register('severity')}>
              <option value="">Select severity…</option>
              <option value="SEV1">SEV1 — critical, all hands</option>
              <option value="SEV2">SEV2 — major degradation</option>
              <option value="SEV3">SEV3 — partial, workaround exists</option>
              <option value="SEV4">SEV4 — minor</option>
            </select>
            {errors.severity && <span className="text-xs text-red-400">Choose a severity</span>}
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-slate-300">Assignee (optional)</span>
            <select className={selectClass} {...register('assigneeId')}>
              <option value="">Unassigned</option>
              {users?.data.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-slate-300">Caused by deployment (optional)</span>
          <select className={selectClass} disabled={!projectId} {...register('deploymentId')}>
            <option value="">
              {projectId ? 'None' : 'Select a project first'}
            </option>
            {projectId &&
              deployments?.data.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.version} · {d.environment} · {new Date(d.startedAt).toLocaleString()}
                </option>
              ))}
          </select>
        </label>

        <FormError message={serverError} />
        <div>
          <SubmitButton pending={isSubmitting}>Create incident</SubmitButton>
        </div>
      </form>
    </main>
  );
}
