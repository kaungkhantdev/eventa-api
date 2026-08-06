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
import type { FieldError } from '../http/validation';
import { Clock } from '../time/clock';

interface Normalized {
  statusCode: number;
  message: string;
  errors?: FieldError[];
}

type ErrorBody = {
  message?: string | string[];
  error?: string;
  errors?: FieldError[];
};

const HTTP_SERVER_ERROR = 500;

/**
 * Catch-all exception filter. Renders every error as the standard failure
 * envelope `{ success: false, statusCode, message, [errors], timestamp }`. Logs
 * 5xx with the stack + correlation id (server-side only) and never leaks
 * internals (stack/SQL/secrets) to the client. The correlation id is on the
 * `x-correlation-id` response header, not in the body.
 */
@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(
    private readonly context: RequestContextService,
    private readonly clock: Clock,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const normalized = this.normalize(exception);
    this.log(normalized, exception);
    // Declared explicitly, because a download route sets its own Content-Type
    // with `@Header` before the handler ever runs — without this, a refused
    // export would arrive as an error envelope labelled `text/csv`, which no
    // client will parse and every browser will offer to save as a file.
    res.type('application/json');
    res.status(normalized.statusCode).json({
      success: false,
      statusCode: normalized.statusCode,
      message: normalized.message,
      ...(normalized.errors ? { errors: normalized.errors } : {}),
      timestamp: this.clock.now().toISOString(),
    });
  }

  private log(n: Normalized, exception: unknown): void {
    const correlationId = this.context.correlationId;
    if (n.statusCode >= HTTP_SERVER_ERROR) {
      const detail =
        exception instanceof Error ? exception.stack : String(exception);
      this.logger.error({ correlationId, statusCode: n.statusCode }, detail);
    } else {
      this.logger.warn({
        correlationId,
        statusCode: n.statusCode,
        message: n.message,
      });
    }
  }

  private normalize(exception: unknown): Normalized {
    if (!(exception instanceof HttpException)) {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'An unexpected error occurred.',
      };
    }
    const statusCode = exception.getStatus();
    const response = exception.getResponse();
    if (typeof response === 'string') return { statusCode, message: response };
    return this.fromBody(statusCode, response, exception);
  }

  private fromBody(
    statusCode: number,
    body: ErrorBody,
    exception: HttpException,
  ): Normalized {
    if (Array.isArray(body.errors)) {
      return {
        statusCode,
        message: this.text(body.message) ?? 'Validation failed.',
        errors: body.errors,
      };
    }
    return {
      statusCode,
      message: this.text(body.message) ?? body.error ?? exception.message,
    };
  }

  private text(message: string | string[] | undefined): string | undefined {
    return typeof message === 'string' ? message : undefined;
  }
}
