import { api } from '@/lib/api';

interface Health {
  status: string;
  database: string;
  uptimeSec: number;
}

export default async function DashboardPage() {
  let health: Health | null = null;
  try {
    health = await api<Health>('/health', { cache: 'no-store' });
  } catch {
    // API not running yet — render the empty state below.
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-2xl font-semibold">Operations dashboard</h1>
      <p className="mt-2 text-slate-400">
        Incident counts, deployment success rate and latency charts render here
        once the dashboard module ships.
      </p>

      <section className="mt-8 rounded-lg border border-slate-800 p-6">
        <h2 className="text-sm uppercase tracking-wider text-slate-500">
          API status
        </h2>
        {health ? (
          <p className="mt-2 text-emerald-400">
            {health.status} — database {health.database}, up{' '}
            {health.uptimeSec}s
          </p>
        ) : (
          <p className="mt-2 text-amber-400">
            API unreachable. Start it with{' '}
            <code className="rounded bg-slate-900 px-1.5 py-0.5">
              npm run dev:api
            </code>
          </p>
        )}
      </section>
    </main>
  );
}
