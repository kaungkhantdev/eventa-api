import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequestContextService } from '../context/request-context';
import { ErrorCode } from '../errors/error-codes';
import type { ErrorEnvelope } from '../errors/error-envelope';

interface Normalized {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

// HTTP status → stable error code. Computed keys keep status handling in plain
// numbers (avoids enum/number comparisons) and drops the need for a switch.
const CODE_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_ERROR,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ErrorCode.VALIDATION_ERROR,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
};

const HTTP_BAD_REQUEST = 400;
const HTTP_SERVER_ERROR = 500;

/**
 * Catch-all exception filter. Renders every error as the standard envelope
 * `{ error: { code, message, details, correlationId } }`, maps status → code,
 * logs 5xx with the stack, and never leaks internals on unexpected errors.
 */
@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly context: RequestContextService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, code, message, details } = this.normalize(exception);
    const correlationId = this.context.correlationId;

    if (status >= HTTP_SERVER_ERROR) {
      this.logger.error(
        { correlationId, code, status },
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn({ correlationId, code, status, message });
    }

    const body: ErrorEnvelope = {
      error: { code, message, details, correlationId },
    };
    res.status(status).json(body);
  }

  private normalize(exception: unknown): Normalized {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();

      if (typeof response === 'string') {
        return { status, code: this.statusToCode(status), message: response };
      }

      const body = response as {
        code?: string;
        message?: string | string[];
        details?: unknown;
        error?: string;
      };

      // DomainException shape: { code, message, details }
      if (typeof body.code === 'string') {
        return {
          status,
          code: body.code,
          message: typeof body.message === 'string' ? body.message : 'Error',
          details: body.details,
        };
      }

      // Nest built-in / ValidationPipe shape: { statusCode, message, error }
      const isValidation =
        status === HTTP_BAD_REQUEST && Array.isArray(body.message);
      return {
        status,
        code: isValidation
          ? ErrorCode.VALIDATION_ERROR
          : this.statusToCode(status),
        message: isValidation
          ? 'Validation failed'
          : Array.isArray(body.message)
            ? body.message.join(', ')
            : (body.message ?? body.error ?? exception.message),
        details: Array.isArray(body.message) ? body.message : undefined,
      };
    }

    // Unknown / programmer error — do not leak internals.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
    };
  }

  private statusToCode(status: number): string {
    return CODE_BY_STATUS[status] ?? ErrorCode.INTERNAL_ERROR;
  }
}
