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

type ErrorBody = {
  code?: string;
  message?: string | string[];
  details?: unknown;
  error?: string;
};

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
    this.log({ status, code, message, details }, correlationId, exception);
    const body: ErrorEnvelope = {
      error: { code, message, details, correlationId },
    };
    res.status(status).json(body);
  }

  private log(
    n: Normalized,
    correlationId: string | undefined,
    exception: unknown,
  ): void {
    if (n.status >= HTTP_SERVER_ERROR) {
      const detail =
        exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(
        { correlationId, code: n.code, status: n.status },
        detail,
      );
    } else {
      this.logger.warn({
        correlationId,
        code: n.code,
        status: n.status,
        message: n.message,
      });
    }
  }

  private normalize(exception: unknown): Normalized {
    if (!(exception instanceof HttpException)) return this.unknownError();
    const response = exception.getResponse();
    if (typeof response === 'string') {
      return this.fromString(exception.getStatus(), response);
    }
    return this.fromObject(exception, response);
  }

  private fromObject(exception: HttpException, body: ErrorBody): Normalized {
    const status = exception.getStatus();
    if (typeof body.code === 'string') return this.fromDomain(status, body);
    return this.fromNest(status, body, exception);
  }

  /** Our DomainException shape: { code, message, details }. */
  private fromDomain(status: number, body: ErrorBody): Normalized {
    const message = typeof body.message === 'string' ? body.message : 'Error';
    return { status, code: body.code!, message, details: body.details };
  }

  /** Nest built-in / ValidationPipe shape: { statusCode, message, error }. */
  private fromNest(
    status: number,
    body: ErrorBody,
    exception: HttpException,
  ): Normalized {
    if (status === HTTP_BAD_REQUEST && Array.isArray(body.message)) {
      return {
        status,
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        details: body.message,
      };
    }
    const message = Array.isArray(body.message)
      ? body.message.join(', ')
      : (body.message ?? body.error ?? exception.message);
    return { status, code: this.statusToCode(status), message };
  }

  private fromString(status: number, message: string): Normalized {
    return { status, code: this.statusToCode(status), message };
  }

  private unknownError(): Normalized {
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
