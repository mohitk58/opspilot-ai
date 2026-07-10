import { HttpException } from '@nestjs/common';

/**
 * Domain exception carrying a stable machine-readable `code` (architecture
 * rule 8). The global ProblemDetailsFilter serializes it as RFC 7807.
 */
export class AppException extends HttpException {
  constructor(
    status: number,
    public readonly code: string,
    public readonly detail: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(detail, status);
  }
}
