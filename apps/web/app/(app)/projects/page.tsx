'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { CreateProjectDto } from '@opspilot/types';
import { ApiKeysPanel } from '@/components/api-keys-panel';
import { FormError, SubmitButton, TextField } from '@/components/form';
import { useCreateProject, useProjects } from '@/hooks/use-projects';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function ProjectsPage() {
  const { user } = useAuth();
  const { data, isPending, error } = useProjects();
  const isAdmin = user?.role === 'ADMIN';

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="mt-1 text-sm text-slate-400">
            Incidents and deployments are grouped per project; the key prefixes
            incident numbers (PAY-42).
          </p>
        </div>
      </div>

      {isAdmin && <CreateProjectForm />}

      <section className="mt-8">
        {isPending && <p className="text-sm text-slate-500">Loading projects…</p>}
        {error && <p className="text-sm text-red-400">{error.message}</p>}
        {data && data.data.length === 0 && (
          <p className="rounded-lg border border-slate-800 p-6 text-sm text-slate-400">
            No projects yet.{' '}
            {isAdmin ? 'Create the first one above.' : 'Ask an admin to create one.'}
          </p>
        )}
        <ul className="grid gap-4 sm:grid-cols-2">
          {data?.data.map((project) => (
            <li key={project.id} className="rounded-lg border border-slate-800 p-5">
              <div className="flex items-center gap-3">
                <span className="rounded bg-slate-900 px-2 py-1 font-mono text-sm text-emerald-400">
                  {project.key}
                </span>
                <h2 className="font-medium">{project.name}</h2>
              </div>
              {project.description && (
                <p className="mt-2 text-sm text-slate-400">{project.description}</p>
              )}
              <p className="mt-3 text-xs text-slate-500">
                {project.members.length} member{project.members.length === 1 ? '' : 's'}
              </p>
              {isAdmin && <ApiKeysPanel projectId={project.id} />}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function CreateProjectForm() {
  const createProject = useCreateProject();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateProjectDto>({ resolver: zodResolver(CreateProjectDto) });

  const onSubmit = handleSubmit(async (dto) => {
    setServerError(null);
    try {
      await createProject.mutateAsync(dto);
      reset();
    } catch (err) {
      setServerError(
        err instanceof ApiError && err.code === 'PROJECT_KEY_TAKEN'
          ? `Key "${dto.key}" is already taken in this organization.`
          : err instanceof Error
            ? err.message
            : 'Something went wrong.',
      );
    }
  });

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="mt-8 grid items-start gap-4 rounded-lg border border-slate-800 p-5 sm:grid-cols-[1fr_10rem_1fr_auto]"
    >
      <TextField label="Name" placeholder="Payments" registration={register('name')} error={errors.name} />
      <TextField label="Key" placeholder="PAY" registration={register('key')} error={errors.key} />
      <TextField
        label="Description (optional)"
        placeholder="Payment processing services"
        registration={register('description')}
        error={errors.description}
      />
      <div className="pt-6">
        <SubmitButton pending={isSubmitting}>Create</SubmitButton>
      </div>
      <div className="sm:col-span-4">
        <FormError message={serverError} />
      </div>
    </form>
  );
}
