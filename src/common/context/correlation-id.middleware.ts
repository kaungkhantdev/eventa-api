import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestContextService } from './request-context';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

type CorrelatedRequest = Request & { correlationId?: string };

/**
 * Establishes the request's correlation id (reuse an inbound `x-correlation-id`,
 * else mint one), echoes it on the response header, stamps it on the request (so
 * pino picks it up), and opens the AsyncLocalStorage store for the request.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  constructor(private readonly context: RequestContextService) {}

  use(req: CorrelatedRequest, res: Response, next: NextFunction): void {
    const inbound = req.header(CORRELATION_ID_HEADER);
    const correlationId =
      inbound && inbound.trim().length > 0 ? inbound.trim() : randomUUID();

    req.correlationId = correlationId;
    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    this.context.run({ correlationId }, () => next());
  }
}
