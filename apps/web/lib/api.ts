import type { AuthResponse } from '@opspilot/types';

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

/** RFC 7807 problem thrown by both fetch wrappers (architecture rule 8). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string,
  ) {
    super(detail);
    this.name = 'ApiError';
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const problem = (await res.json()) as {
      code?: string;
      detail?: string;
      title?: string;
    };
    return new ApiError(
      res.status,
      problem.code ?? 'UNKNOWN',
      problem.detail ?? problem.title ?? res.statusText,
    );
  } catch {
    return new ApiError(res.status, 'UNKNOWN', res.statusText);
  }
}

/** Plain fetch wrapper for public endpoints; safe in server components. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) throw await toApiError(res);
  return res.json() as Promise<T>;
}

// ── Client-side authenticated fetch ─────────────────────────
// The access JWT lives only in this module-scoped variable — in memory,
// never persisted (auth rule 10). A page reload re-establishes the session
// through the httpOnly refresh cookie via refreshSession().

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

let refreshInFlight: Promise<AuthResponse | null> | null = null;

/**
 * Rotate the refresh cookie into a fresh session. Single-flight so
 * concurrent 401s don't race the rotation chain (a replayed token burns
 * every session server-side).
 */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return null;
      const session = (await res.json()) as AuthResponse;
      accessToken = session.accessToken;
      return session;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * Fetch with the bearer token; on 401, rotates the refresh token once and
 * retries. /auth/* requests are never retried — a 401 there is a real
 * answer, and replaying a login would resubmit credentials.
 */
export async function authApi<T>(path: string, init?: RequestInit): Promise<T> {
  const doFetch = () =>
    fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });

  let res = await doFetch();
  if (res.status === 401 && !path.startsWith('/auth/')) {
    if (await refreshSession()) res = await doFetch();
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
