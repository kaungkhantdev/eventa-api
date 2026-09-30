import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';
import {
  RESPONSE_MESSAGE_KEY,
  type ResponseMessageResolver,
} from '../decorators/response-message.decorator';
import { SKIP_ENVELOPE_KEY } from '../decorators/skip-envelope.decorator';
import { Paginated, type PageMeta } from '../http/paginated';
import { Clock } from '../time/clock';

interface SuccessEnvelope {
  success: true;
  statusCode: number;
  message: string;
  data: unknown;
  meta?: PageMeta;
  timestamp: string;
}

const HTTP_NO_CONTENT = 204;
const DEFAULT_MESSAGE = 'Success';

/** What @ResponseMessage stored: a literal, or a resolver over what the handler answered. */
type RouteMessage = string | ResponseMessageResolver<never>;

/**
 * Wraps every successful response in the standard envelope
 * `{ success, statusCode, message, data, [meta], timestamp }`. A Paginated result
 * adds `meta`. Errors bypass this (the exception filter renders the failure
 * envelope). Opt out with @SkipResponseEnvelope (health probes). Set the message
 * per route with @ResponseMessage — a literal, or a resolver read from what the
 * handler answered where one route has two outcomes.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly clock: Clock,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.isSkipped(ctx)) return next.handle();
    const res = ctx.switchToHttp().getResponse<Response>();
    const message = this.messageFor(ctx);
    return next.handle().pipe(map((value) => this.wrap(value, res, message)));
  }

  private wrap(value: unknown, res: Response, message: RouteMessage): unknown {
    if (res.statusCode === HTTP_NO_CONTENT) return value; // no body
    const timestamp = this.clock.now().toISOString();
    const head = {
      success: true,
      statusCode: res.statusCode,
      message: this.resolve(message, value),
    } as const;
    if (value instanceof Paginated) {
      const envelope: SuccessEnvelope = {
        ...head,
        data: value.items,
        meta: value.meta,
        timestamp,
      };
      return envelope;
    }
    const envelope: SuccessEnvelope = {
      ...head,
      data: value ?? null,
      timestamp,
    };
    return envelope;
  }

  private isSkipped(ctx: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? false
    );
  }

  private messageFor(ctx: ExecutionContext): RouteMessage {
    return (
      this.reflector.getAllAndOverride<RouteMessage>(RESPONSE_MESSAGE_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? DEFAULT_MESSAGE
    );
  }

  /**
   * A resolver's parameter is the handler's own return type, which is not
   * knowable from here — the decorator on the route is what ties the two
   * together, and the handler is the only thing that feeds it.
   */
  private resolve(message: RouteMessage, value: unknown): string {
    return typeof message === 'function' ? message(value as never) : message;
  }
}
