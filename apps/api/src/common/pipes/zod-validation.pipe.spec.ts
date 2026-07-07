import { SignupDto } from '@opspilot/types';
import { AppException } from '../app.exception';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(SignupDto);

  it('returns the parsed value on success', () => {
    const value = { email: 'a@b.co', password: 'longenough', fullName: 'Jane' };
    expect(pipe.transform(value)).toEqual(value);
  });

  it('throws 422 VALIDATION_FAILED with flattened field errors', () => {
    try {
      pipe.transform({ email: 'not-an-email', password: 'short' });
      fail('expected AppException');
    } catch (err) {
      const e = err as AppException;
      expect(e.getStatus()).toBe(422);
      expect(e.code).toBe('VALIDATION_FAILED');
      expect(e.extra?.errors).toMatchObject({
        email: expect.any(Array),
        password: expect.any(Array),
        fullName: expect.any(Array),
      });
    }
  });
});
