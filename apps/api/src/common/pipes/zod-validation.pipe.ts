import { Injectable, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';
import { AppException } from '../app.exception';

/**
 * Validates a request body/query against a Zod schema from @opspilot/types
 * (architecture rule 2). Failures return 422 problem+json with the
 * flattened Zod issues under `errors`.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppException(422, 'VALIDATION_FAILED', 'Request validation failed', {
        errors: result.error.flatten().fieldErrors,
      });
    }
    return result.data;
  }
}
