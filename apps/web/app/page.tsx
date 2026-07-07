import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-start justify-center gap-6 px-6">
      <p className="text-sm uppercase tracking-widest text-emerald-400">
        OpsPilot AI
      </p>
      <h1 className="text-4xl font-semibold leading-tight">
        Incidents, deployments and system health — one place, one timeline.
      </h1>
      <p className="max-w-xl text-lg text-slate-400">
        Stop tab-hopping between five tools during an outage. Track what broke,
        what changed, and who is on it.
      </p>
      <div className="flex gap-4">
        <Link
          href="/login"
          className="rounded-md bg-emerald-500 px-5 py-2.5 font-medium text-slate-950 hover:bg-emerald-400"
        >
          Sign in
        </Link>
        <Link
          href="/dashboard"
          className="rounded-md border border-slate-700 px-5 py-2.5 font-medium hover:border-slate-500"
        >
          View dashboard
        </Link>
      </div>
    </main>
  );
}
