import { randomUUID } from 'crypto';
import type { IncomingMessage } from 'http';
import type { AccessTokenPayload } from '../auth/token.service';

// pino-http's callbacks are typed against Node's raw http objects, not
// Express's — Express attaches `user` (JwtAuthGuard) at runtime, so it's
// added here as the one field we actually read.
type PinoRequest = IncomingMessage & { user?: AccessTokenPayload };

/** FR-5: reuse an incoming request id rather than always minting a new one. */
export function resolveRequestId(req: PinoRequest): string {
  const incoming = req.headers['x-request-id'];
  return (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
}

/**
 * userId for the access-log line. Read at response time (pino-http's
 * customProps fires in the res 'finish' handler), so req.user — set by
 * JwtAuthGuard — is already populated for authenticated routes.
 */
export function extractUserId(req: PinoRequest): string | undefined {
  return req.user?.sub;
}

const NOISY_PATHS = new Set(['/metrics', '/api/v1/health']);

/**
 * Skips the access-log line for scrape/health polling (docs/02 §5).
 * pino-http's autoLogging.ignore only sees the request, not the response,
 * so this suppresses by path unconditionally, failures included — a health
 * check failing loud enough to matter shows up in the /health response
 * itself and in the Prometheus/Grafana alerts, not the access log.
 */
export function isNoisyRequest(req: PinoRequest): boolean {
  return NOISY_PATHS.has(req.url ?? '');
}

/** LOG_LEVEL env wins; otherwise info in prod, debug elsewhere (docs/02 §5). */
export function resolveLogLevel(env: NodeJS.ProcessEnv = process.env): string {
  return env.LOG_LEVEL ?? (env.NODE_ENV === 'production' ? 'info' : 'debug');
}
