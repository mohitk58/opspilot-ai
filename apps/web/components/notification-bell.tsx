'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { NotificationDto } from '@opspilot/types';
import { useMarkAllRead, useMarkRead, useNotifications } from '@/hooks/use-notifications';

/** Header bell (N1): unread badge, dropdown, mark-read on click. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const { data } = useNotifications({ pageSize: 10 });
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();
  const unread = data?.unreadCount ?? 0;

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        className="relative rounded-md border border-slate-700 px-2.5 py-1.5 text-sm hover:border-slate-500"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-96 rounded-lg border border-slate-700 bg-slate-950 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
            <span className="text-xs uppercase tracking-wider text-slate-500">Notifications</span>
            {unread > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className="text-xs text-emerald-400 hover:underline disabled:opacity-50"
              >
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {data?.data.map((n) => (
              <NotificationRow
                key={n.id}
                notification={n}
                onOpen={() => {
                  if (!n.readAt) markRead.mutate(n.id);
                  setOpen(false);
                }}
              />
            ))}
            {data && data.data.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-slate-500">
                Nothing yet — you&apos;ll hear about assignments, status changes and failed deploys.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function NotificationRow({
  notification,
  onOpen,
}: {
  notification: NotificationDto;
  onOpen: () => void;
}) {
  const inner = (
    <div className="flex items-start gap-2 px-4 py-3 text-sm hover:bg-slate-900/70">
      <span
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${notification.readAt ? 'bg-slate-700' : 'bg-emerald-400'}`}
      />
      <span className="min-w-0">
        <span className={`block truncate ${notification.readAt ? 'text-slate-400' : 'text-slate-100'}`}>
          {notification.title}
        </span>
        <span className="block truncate text-xs text-slate-500">{notification.body}</span>
        <span className="block text-xs text-slate-600">
          {new Date(notification.createdAt).toLocaleString()}
        </span>
      </span>
    </div>
  );

  return (
    <li className="border-b border-slate-800/60 last:border-0">
      {notification.link ? (
        <Link href={notification.link} onClick={onOpen}>
          {inner}
        </Link>
      ) : (
        <button onClick={onOpen} className="w-full text-left">
          {inner}
        </button>
      )}
    </li>
  );
}
