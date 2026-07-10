'use client';

import { useState } from 'react';
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/hooks/use-api-keys';

/**
 * ADMIN-only CI key management for one project. The plaintext key is shown
 * exactly once, right after creation — the API stores only its hash.
 */
export function ApiKeysPanel({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const { data: keys } = useApiKeys(projectId, open);
  const createKey = useCreateApiKey(projectId);
  const revokeKey = useRevokeApiKey(projectId);

  async function create() {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    const created = await createKey.mutateAsync({ name: trimmed });
    setFreshKey(created.plaintextKey);
    setName('');
  }

  return (
    <div className="mt-3 border-t border-slate-800 pt-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs uppercase tracking-wider text-slate-500 hover:text-slate-300"
      >
        API keys {open ? '▾' : '▸'}
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-3 text-sm">
          {freshKey && (
            <div className="rounded-md border border-emerald-800 bg-emerald-950/40 p-3">
              <p className="text-xs text-emerald-400">
                Copy this key now — it is shown only once:
              </p>
              <code className="mt-1 block select-all break-all font-mono text-xs text-emerald-300">
                {freshKey}
              </code>
              <button
                onClick={() => setFreshKey(null)}
                className="mt-2 text-xs text-slate-400 hover:text-slate-200"
              >
                I saved it — dismiss
              </button>
            </div>
          )}

          <ul className="flex flex-col gap-2">
            {keys?.map((key) => (
              <li key={key.id} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <code className="font-mono text-xs text-slate-400">{key.prefix}…</code>
                  <span className={key.revokedAt ? 'text-slate-600 line-through' : ''}>
                    {key.name}
                  </span>
                  <span className="text-xs text-slate-600">
                    {key.revokedAt
                      ? 'revoked'
                      : key.lastUsedAt
                        ? `used ${new Date(key.lastUsedAt).toLocaleDateString()}`
                        : 'never used'}
                  </span>
                </span>
                {!key.revokedAt && (
                  <button
                    onClick={() => revokeKey.mutate(key.id)}
                    disabled={revokeKey.isPending}
                    className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
            {keys?.length === 0 && <li className="text-xs text-slate-600">No keys yet.</li>}
          </ul>

          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Key name, e.g. github-actions"
              className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-emerald-500"
            />
            <button
              onClick={create}
              disabled={createKey.isPending || name.trim().length < 2}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-xs hover:border-slate-500 disabled:opacity-50"
            >
              {createKey.isPending ? 'Creating…' : 'Create key'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
