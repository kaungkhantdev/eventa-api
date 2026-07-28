import { Injectable } from '@nestjs/common';

/**
 * Abstraction over the system clock. Inject `Clock` into domain/business code
 * instead of calling `Date.now()` / `new Date()` directly — keeps the domain free
 * of an infrastructure dependency and makes time deterministic in tests.
 */
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
