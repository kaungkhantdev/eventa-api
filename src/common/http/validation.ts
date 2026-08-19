import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

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
 */
export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    exceptionFactory: (errors: ValidationError[]) =>
      new BadRequestException({
        message: 'Validation failed.',
        errors: toFieldErrors(errors),
      }),
  });
}
