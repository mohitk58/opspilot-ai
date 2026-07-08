'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import {
  INCIDENT_TRANSITIONS,
  TIMELINE_PAYLOADS,
  type IncidentStatus,
  type TimelineEventDto,
} from '@opspilot/types';
import { EnvBadge, SeverityBadge, StatusBadge } from '@/components/badges';
import {
  useAddComment,
  useChangeStatus,
  useIncident,
  useTimeline,
  useUpdateIncident,
} from '@/hooks/use-incidents';
import { useOrgUsers } from '@/hooks/use-users';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const selectClass =
  'rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-emerald-500';

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { data: incident, isPending, error } = useIncident(id);
  const { data: timeline } = useTimeline(id);
  const { data: users } = useOrgUsers();
  const changeStatus = useChangeStatus(id);
  const updateIncident = useUpdateIncident(id);
  const [actionError, setActionError] = useState<string | null>(null);
  const canWrite = user?.role !== 'VIEWER';

  if (isPending) {
    return <main className="px-6 py-12 text-center text-sm text-slate-500">Loading incident…</main>;
  }
  if (error || !incident) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-sm text-red-400">{error?.message ?? 'Incident not found.'}</p>
        <Link href="/incidents" className="mt-4 inline-block text-sm text-emerald-400 hover:underline">
          ← Back to incidents
        </Link>
      </main>
    );
  }

  const nextStatuses = INCIDENT_TRANSITIONS[incident.status];

  async function onStatusChange(status: IncidentStatus) {
    setActionError(null);
    try {
      await changeStatus.mutateAsync({ status });
    } catch (err) {
      // Optimistic update already rolled back in the hook; surface why.
      setActionError(
        err instanceof ApiError && err.status === 422
          ? err.message
          : 'Could not change status.',
      );
    }
  }

  async function onAssign(assigneeId: string) {
    setActionError(null);
    try {
      await updateIncident.mutateAsync({ assigneeId: assigneeId || null });
    } catch {
      setActionError('Could not change assignee.');
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/incidents" className="text-sm text-slate-500 hover:text-slate-300">
        ← Incidents
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="font-mono text-slate-400">{incident.displayNumber}</span>
        <SeverityBadge severity={incident.severity} />
        <StatusBadge status={incident.status} />
      </div>
      <h1 className="mt-2 text-2xl font-semibold">{incident.title}</h1>
      <p className="mt-1 text-xs text-slate-500">
        Opened by {incident.createdBy.fullName} on{' '}
        {new Date(incident.createdAt).toLocaleString()}
        {incident.resolvedAt && ` · resolved ${new Date(incident.resolvedAt).toLocaleString()}`}
      </p>
      {incident.deployment && (
        <p className="mt-2 flex items-center gap-2 text-xs text-slate-400">
          Caused by deployment{' '}
          <code className="rounded bg-slate-900 px-1.5 py-0.5 font-mono">
            {incident.deployment.version}
          </code>
          <EnvBadge env={incident.deployment.environment} />
        </p>
      )}

      {canWrite && (
        <div className="mt-6 flex flex-wrap items-end gap-4 rounded-lg border border-slate-800 p-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs uppercase tracking-wider text-slate-500">Move to</span>
            <select
              className={selectClass}
              value=""
              disabled={nextStatuses.length === 0 || changeStatus.isPending}
              onChange={(e) => e.target.value && onStatusChange(e.target.value as IncidentStatus)}
            >
              <option value="">
                {nextStatuses.length ? 'Change status…' : 'Resolved (terminal)'}
              </option>
              {/* Only legal transitions are offered — same table the API enforces */}
              {nextStatuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs uppercase tracking-wider text-slate-500">Assignee</span>
            <select
              className={selectClass}
              value={incident.assignee?.id ?? ''}
              disabled={updateIncident.isPending}
              onChange={(e) => onAssign(e.target.value)}
            >
              <option value="">Unassigned</option>
              {users?.data.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </select>
          </label>
          {actionError && <p className="text-sm text-red-400">{actionError}</p>}
        </div>
      )}

      <section className="mt-6 whitespace-pre-wrap rounded-lg border border-slate-800 p-5 text-sm text-slate-300">
        {incident.description}
      </section>

      <section className="mt-10">
        <h2 className="text-sm uppercase tracking-wider text-slate-500">Timeline</h2>
        <ol className="mt-4 flex flex-col gap-4 border-l border-slate-800 pl-5">
          {timeline?.data.map((event) => (
            <li key={event.id} className="relative">
              <span className="absolute -left-[1.45rem] top-1.5 h-2 w-2 rounded-full bg-slate-600" />
              <TimelineEntry event={event} />
            </li>
          ))}
        </ol>
        {canWrite && <CommentComposer incidentId={id} />}
      </section>
    </main>
  );
}

function TimelineEntry({ event }: { event: TimelineEventDto }) {
  const when = new Date(event.createdAt).toLocaleString();
  const head = (
    <p className="text-xs text-slate-500">
      <span className="text-slate-400">{event.actor.fullName}</span> · {when}
    </p>
  );

  switch (event.type) {
    case 'CREATED': {
      const p = TIMELINE_PAYLOADS.CREATED.parse(event.payload);
      return (
        <div>
          {head}
          <p className="mt-1 text-sm text-slate-300">
            opened this incident as <SeverityBadge severity={p.severity} />
          </p>
        </div>
      );
    }
    case 'STATUS_CHANGED': {
      const p = TIMELINE_PAYLOADS.STATUS_CHANGED.parse(event.payload);
      return (
        <div>
          {head}
          <p className="mt-1 flex items-center gap-2 text-sm text-slate-300">
            moved <StatusBadge status={p.from} /> → <StatusBadge status={p.to} />
          </p>
          {p.comment && <p className="mt-1 text-sm italic text-slate-400">“{p.comment}”</p>}
        </div>
      );
    }
    case 'ASSIGNED': {
      const p = TIMELINE_PAYLOADS.ASSIGNED.parse(event.payload);
      return (
        <div>
          {head}
          <p className="mt-1 text-sm text-slate-300">
            {p.assigneeId ? `assigned this to ${p.assigneeName}` : 'unassigned this incident'}
          </p>
        </div>
      );
    }
    case 'COMMENT': {
      const p = TIMELINE_PAYLOADS.COMMENT.parse(event.payload);
      return (
        <div>
          {head}
          <p className="mt-1 whitespace-pre-wrap rounded-md border border-slate-800 bg-slate-900/60 p-3 text-sm text-slate-200">
            {p.body}
          </p>
        </div>
      );
    }
    case 'LINKED_DEPLOYMENT': {
      const p = TIMELINE_PAYLOADS.LINKED_DEPLOYMENT.parse(event.payload);
      return (
        <div>
          {head}
          <p className="mt-1 flex items-center gap-2 text-sm text-slate-300">
            linked deployment
            <code className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-xs">
              {p.version ?? p.deploymentId.slice(0, 8)}
            </code>
            {p.environment && <EnvBadge env={p.environment} />}
          </p>
        </div>
      );
    }
    case 'SEVERITY_CHANGED': {
      const p = TIMELINE_PAYLOADS.SEVERITY_CHANGED.parse(event.payload);
      return (
        <div>
          {head}
          <p className="mt-1 flex items-center gap-2 text-sm text-slate-300">
            changed severity <SeverityBadge severity={p.from} /> → <SeverityBadge severity={p.to} />
          </p>
        </div>
      );
    }
    default:
      return (
        <div>
          {head}
          <p className="mt-1 text-sm text-slate-400">{event.type}</p>
        </div>
      );
  }
}

function CommentComposer({ incidentId }: { incidentId: string }) {
  const addComment = useAddComment(incidentId);
  const [body, setBody] = useState('');

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed) return;
    await addComment.mutateAsync({ body: trimmed });
    setBody('');
  }

  return (
    <div className="mt-6 flex flex-col gap-2">
      <textarea
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a comment…"
        className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
      />
      <div>
        <button
          onClick={submit}
          disabled={addComment.isPending || !body.trim()}
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {addComment.isPending ? 'Posting…' : 'Comment'}
        </button>
      </div>
    </div>
  );
}
