import { HttpException } from '@nestjs/common';
import { IsEmail, IsInt } from 'class-validator';
import { ErrorCode } from '../errors/error-codes';
import { buildValidationPipe, type FieldError } from './validation';

class SignUpDto {
  @IsEmail({}, { message: 'Email is invalid.' })
  email!: string;

  @IsInt({ message: 'Age must be a whole number.' })
  age!: number;
}

interface RejectionBody {
  code?: string;
  message?: string;
  errors?: FieldError[];
}

/**
 * Driven through `transform()` rather than `createExceptionFactory()`: that
 * method returns Nest's OWN default factory, not the one this builder passes
 * in its options, so asserting against it proves nothing about this file.
 */
async function reject(value: unknown): Promise<RejectionBody> {
  try {
    await buildValidationPipe().transform(value, {
      type: 'body',
      metatype: SignUpDto,
    });
  } catch (e) {
    return (e as HttpException).getResponse() as RejectionBody;
  }
  throw new Error('the pipe accepted a value it should have rejected');
}

describe('buildValidationPipe', () => {
  it('names every rejected field, with the message the reader sees', async () => {
    const body = await reject({ email: 'not-an-email', age: 'old' });

    expect(body.errors).toEqual([
      { field: 'email', message: 'Email is invalid.' },
      { field: 'age', message: 'Age must be a whole number.' },
    ]);
  });

  /**
   * A rejected DTO is the commonest error this API returns. The filter
   * forwards the code an exception carries rather than deriving one from the
   * status, so a pipe that named none would leave the one error every client
   * meets as the only one with nothing to branch on.
   */
  it('carries the code the filter forwards to the client', async () => {
    expect((await reject({ email: 'nope', age: 1 })).code).toBe(
      ErrorCode.VALIDATION_ERROR,
    );
  });

  it('refuses a field the DTO does not declare, rather than dropping it', async () => {
    // `forbidNonWhitelisted`: a typo'd or stale field name is reported, not
    // silently stripped into a write that ignores half the request.
    const body = await reject({
      email: 'someone@example.test',
      age: 30,
      nickname: 'x',
    });

    expect(body.errors?.map((e) => e.field)).toContain('nickname');
  });

  it('accepts a valid body, coercing what arrived as a string', async () => {
    const dto: unknown = await buildValidationPipe().transform(
      { email: 'someone@example.test', age: '30' },
      { type: 'body', metatype: SignUpDto },
    );

    // `enableImplicitConversion` is what lets a query/body number arrive as
    // text and still satisfy `@IsInt`.
    expect(dto).toEqual({ email: 'someone@example.test', age: 30 });
  });
});
