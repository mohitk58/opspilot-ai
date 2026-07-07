import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { AppException } from '../app.exception';

/** Fallback codes for framework-thrown HttpExceptions without an AppException code. */
const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

/**
 * Global exception filter emitting RFC 7807 application/problem+json with a
 * stable `code` on every error response (architecture rule 8).
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<{ url: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let detail = 'An unexpected error occurred';
    let extra: Record<string, unknown> = {};

    if (exception instanceof AppException) {
      status = exception.getStatus();
      code = exception.code;
      detail = exception.detail;
      extra = exception.extra ?? {};
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_CODES[status] ?? `HTTP_${status}`;
      const body = exception.getResponse();
      detail =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message?.toString() ??
            exception.message);
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    // "UNPROCESSABLE_ENTITY" → "Unprocessable Entity" (RFC 7807 titles are human-readable)
    const title =
      HttpStatus[status]
        ?.toLowerCase()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase()) ?? 'Error';

    res
      .status(status)
      .type('application/problem+json')
      .json({
        type: `https://opspilot.dev/problems/${code.toLowerCase()}`,
        title,
        status,
        code,
        detail,
        instance: req.url,
        ...extra,
      });
  }
}
