import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { httpErrors, httpRequestDuration } from './metrics';

/** Observes every HTTP request into the duration histogram (docs/02 §5). */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const started = process.hrtime.bigint();
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      finalize(() => {
        const seconds = Number(process.hrtime.bigint() - started) / 1e9;
        // Route pattern, not URL — /api/v1/incidents/:id, bounded cardinality
        const route = req.route?.path ?? 'unmatched';
        const status = String(res.statusCode);
        httpRequestDuration.observe({ method: req.method, route, status }, seconds);
        if (res.statusCode >= 500) httpErrors.inc({ method: req.method, route });
      }),
    );
  }
}
