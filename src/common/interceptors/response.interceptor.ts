import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import { SKIP_ENVELOPE_KEY } from '../decorators/skip-envelope.decorator';
import { Paginated } from '../http/paginated';

/**
 * Wraps every successful response in the standard envelope: `{ data }`, or
 * `{ data, meta }` for a Paginated result. Errors bypass this (the exception
 * filter renders `{ error }`). Opt out with @SkipResponseEnvelope (e.g. health).
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (skip) return next.handle();
    return next.handle().pipe(map((value) => this.wrap(value)));
  }

  private wrap(value: unknown): unknown {
    if (value === undefined || value === null) return value; // 204 / no content
    if (value instanceof Paginated) {
      return { data: value.items, meta: value.meta };
    }
    return { data: value };
  }
}
