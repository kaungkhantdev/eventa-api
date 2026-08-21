import { HttpException, HttpStatus } from '@nestjs/common';
import type { FieldError } from '../http/validation';
import { ErrorCode } from './error-codes';

/**
 * Base class for expected, domain-level failures. Carries a stable `code` and
 * optional `details`; the global filter renders it into the error envelope.
 * Prefer the factory helpers over `throw new HttpException(...)`.
 */
export class DomainException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: HttpStatus,
    readonly details?: unknown,
    /**
     * Which field the caller got wrong, when there is one. Rendered into the
     * envelope's `errors` array — the same array class-validator fills — so a
     * client can put the sentence under the input it belongs to instead of at
     * the foot of the form. Omitted entirely when nothing is to blame: an
     * empty array would read as a claim rather than an absence.
     */
    readonly errors?: FieldError[],
  ) {
    super({ code, message, details, ...(errors ? { errors } : {}) }, status);
  }

  static notFound(message = 'Resource not found', details?: unknown) {
    return new DomainException(
      ErrorCode.NOT_FOUND,
      message,
      HttpStatus.NOT_FOUND,
      details,
    );
  }

  static unauthorized(message = 'Unauthorized', details?: unknown) {
    return new DomainException(
      ErrorCode.UNAUTHORIZED,
      message,
      HttpStatus.UNAUTHORIZED,
      details,
    );
  }

  static forbidden(message = 'Forbidden', details?: unknown) {
    return new DomainException(
      ErrorCode.FORBIDDEN,
      message,
      HttpStatus.FORBIDDEN,
      details,
    );
  }

  static conflict(message = 'Conflict', details?: unknown) {
    return new DomainException(
      ErrorCode.CONFLICT,
      message,
      HttpStatus.CONFLICT,
      details,
    );
  }

  static validation(message = 'Validation failed', details?: unknown) {
    return new DomainException(
      ErrorCode.VALIDATION_ERROR,
      message,
      HttpStatus.UNPROCESSABLE_ENTITY,
      details,
    );
  }

  /**
   * A validation failure the caller can fix in one named field.
   *
   * The message is repeated into the field entry on purpose: anything showing
   * a form wants it beside the input, and anything that is not — a script, a
   * log line — still reads the sentence at the top of the envelope.
   */
  static invalidField(field: string, message: string) {
    return new DomainException(
      ErrorCode.VALIDATION_ERROR,
      message,
      HttpStatus.UNPROCESSABLE_ENTITY,
      undefined,
      [{ field, message }],
    );
  }

  static tooManyRequests(message = 'Too many requests', details?: unknown) {
    return new DomainException(
      ErrorCode.RATE_LIMITED,
      message,
      HttpStatus.TOO_MANY_REQUESTS,
      details,
    );
  }
}
