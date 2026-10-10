import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { ErrorCode } from '../errors/error-codes';

export interface FieldError {
  field: string;
  message: string;
}

function toFieldErrors(errors: ValidationError[]): FieldError[] {
  return errors.flatMap((e) =>
    Object.values(e.constraints ?? {}).map((message) => ({
      field: e.property,
      message,
    })),
  );
}

/**
 * The app-wide validation pipe. Maps class-validator failures into structured
 * `{ field, message }[]` (never raw constraint dumps) so the error filter can
 * render them as the `errors` array of the failure envelope.
 *
 * It names its own `code` for the same reason `DomainException` does: the
 * filter forwards the code an exception carries rather than deriving one from
 * the status, and a rejected DTO is the commonest error the API returns. Left
 * uncoded, the one error every client meets would be the one with no code to
 * branch on.
 */
export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    exceptionFactory: (errors: ValidationError[]) =>
      new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed.',
        errors: toFieldErrors(errors),
      }),
  });
}
