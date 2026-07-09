import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

/**
 * Module-scoped singletons on a dedicated registry (docs/02 §5). Deliberately
 * DI-free so infra code (RedisService, interceptor, workers) can record
 * without module dependencies or circular imports.
 */
export const registry = new Registry();
collectDefaultMetrics({ register: registry }); // process/node defaults

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration by route pattern',
  labelNames: ['method', 'route', 'status'] as const,
  // route is the Nest/Express route PATTERN (/api/v1/incidents/:id), so
  // cardinality stays bounded
  buckets: [0.005, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const httpErrors = new Counter({
  name: 'http_errors_total',
  help: 'HTTP responses with status >= 500',
  labelNames: ['method', 'route'] as const,
  registers: [registry],
});

export const cacheOps = new Counter({
  name: 'cache_ops_total',
  help: 'Redis cache-aside reads by key prefix and outcome',
  labelNames: ['prefix', 'result'] as const, // result: hit | miss | degraded
  registers: [registry],
});

export const outboxPending = new Gauge({
  name: 'outbox_pending_events',
  help: 'OutboxEvent rows not yet published to RabbitMQ',
  registers: [registry],
});
