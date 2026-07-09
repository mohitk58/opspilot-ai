'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { NotificationBell } from '@/components/notification-bell';
import { bootstrapSession, logout, useAuth } from '@/lib/auth';

/**
 * Auth guard for everything under (app). The access token lives only in
 * memory, so after a full page load we first try to rebuild the session
 * from the httpOnly refresh cookie before deciding to bounce to /login.
 */
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === 'unknown') void bootstrapSession();
  }, [status]);

  useEffect(() => {
    if (status === 'guest') router.replace('/login');
  }, [status, router]);

  if (status !== 'authenticated' || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Checking session…
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <nav className="flex items-center gap-6">
            <Link href="/dashboard" className="font-semibold">
              OpsPilot <span className="text-emerald-400">AI</span>
            </Link>
            <Link href="/incidents" className="text-sm text-slate-400 hover:text-slate-100">
              Incidents
            </Link>
            <Link href="/deployments" className="text-sm text-slate-400 hover:text-slate-100">
              Deployments
            </Link>
            <Link href="/projects" className="text-sm text-slate-400 hover:text-slate-100">
              Projects
            </Link>
          </nav>
          <div className="flex items-center gap-4 text-sm">
            <NotificationBell />
            <span className="text-slate-400">{user.fullName}</span>
            <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs uppercase tracking-wider text-slate-400">
              {user.role}
            </span>
            <button
              onClick={() => void logout().then(() => router.replace('/login'))}
              className="rounded-md border border-slate-700 px-3 py-1.5 hover:border-slate-500"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
