import { HttpException, HttpStatus } from '@nestjs/common';
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
  ) {
    super({ code, message, details }, status);
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

  static tooManyRequests(message = 'Too many requests', details?: unknown) {
    return new DomainException(
      ErrorCode.RATE_LIMITED,
      message,
      HttpStatus.TOO_MANY_REQUESTS,
      details,
    );
  }
}
