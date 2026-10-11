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
import { redactedQueryStack } from '../errors/pg-error';
import type { FieldError } from '../http/validation';
import { Clock } from '../time/clock';

interface Normalized {
  statusCode: number;
  code?: ErrorCode;
  message: string;
  errors?: FieldError[];
}

type ErrorBody = {
  code?: unknown;
  message?: string | string[];
  error?: string;
  errors?: FieldError[];
};

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.values(ErrorCode));

/**
 * The thrower's own code, kept only if the enum defines it.
 *
 * `getResponse()` is an arbitrary payload — anything that throws an
 * `HttpException` can put a `code` on it, including libraries this repo does
 * not own. Checking it against `ErrorCode` means the envelope can only ever
 * publish one of this API's own stable codes, so no third party can use the
 * field to leak a driver string or a connection detail to the browser.
 */
function knownCode(value: unknown): ErrorCode | undefined {
  return typeof value === 'string' && KNOWN_CODES.has(value)
    ? (value as ErrorCode)
    : undefined;
}

const HTTP_SERVER_ERROR = 500;

/**
 * Catch-all exception filter. Renders every error as the standard failure
 * envelope `{ success: false, statusCode, [code], message, [errors],
 * timestamp }`. Logs 5xx with the stack + correlation id (server-side only)
 * and never leaks internals (stack/SQL/secrets) to the client. The correlation
 * id is on the `x-correlation-id` response header, not in the body.
 *
 * `code` is the stable, machine-readable half of the envelope, and it comes
 * from whatever threw — `DomainException` and the validation pipe both name
 * theirs. It is NOT derived from the status here, and that is the point: the
 * codes worth having are the ones a status cannot reconstruct
 * (`PHONE_CODE_EXPIRED` shares 422 with an ordinary mistyped field;
 * `ATTENDEE_EMAIL_IN_USE` shares 409 with a stale-version conflict), and a
 * status table would answer those two with the generic code and quietly undo
 * the distinction they exist for. So it is absent on exceptions that named no
 * code — Nest's own 404 for an unmatched route, a 405 — where the status
 * already says everything there is to say, and `eventa-web`'s `ApiError`
 * fills in a status-derived default for exactly that case.
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
      ...(normalized.code ? { code: normalized.code } : {}),
      message: normalized.message,
      ...(normalized.errors ? { errors: normalized.errors } : {}),
      timestamp: this.clock.now().toISOString(),
    });
  }

  private log(n: Normalized, exception: unknown): void {
    const correlationId = this.context.correlationId;
    if (n.statusCode >= HTTP_SERVER_ERROR) {
      this.logger.error(
        { correlationId, statusCode: n.statusCode },
        serverDetail(exception),
      );
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
      // Nothing from the exception reaches the client here, the code least of
      // all — it is the one constant that says "this was not your request's
      // fault" without describing what went wrong.
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: ErrorCode.INTERNAL_ERROR,
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
    const code = knownCode(body.code);
    if (Array.isArray(body.errors)) {
      return {
        statusCode,
        code,
        message: this.text(body.message) ?? 'Validation failed.',
        errors: body.errors,
      };
    }
    return {
      statusCode,
      code,
      message: this.text(body.message) ?? body.error ?? exception.message,
    };
  }

  private text(message: string | string[] | undefined): string | undefined {
    return typeof message === 'string' ? message : undefined;
  }
}

/**
 * What a 5xx may write about itself.
 *
 * A stack begins with the error's MESSAGE, and Drizzle's message carries the
 * statement and every bound value — for the checkout insert, the buyer's name,
 * email and phone. So a failed query is logged as its frames plus what the
 * database refused, and nothing else; anything else keeps its own words,
 * because over-redacting a log hides the outages it exists to show.
 */
function serverDetail(exception: unknown): string {
  return (
    redactedQueryStack(exception) ??
    (exception instanceof Error
      ? (exception.stack ?? exception.message)
      : String(exception))
  );
}
