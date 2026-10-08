import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import type { Clock } from '../time/clock';
import { ResponseInterceptor } from './response.interceptor';

const NOW = new Date('2026-08-05T03:00:00.000Z');

function contextWith(statusCode = 200): ExecutionContext {
  return {
    switchToHttp: () => ({ getResponse: () => ({ statusCode }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

const handlerReturning = (value: unknown): CallHandler =>
  ({ handle: () => of(value) }) as CallHandler;

interface Envelope {
  message: string;
  data: unknown;
}

describe('ResponseInterceptor', () => {
  let reflector: jest.Mocked<Reflector>;
  let interceptor: ResponseInterceptor;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;
    const clock: Clock = { now: () => NOW };
    interceptor = new ResponseInterceptor(reflector, clock);
  });

  /** @SkipResponseEnvelope is read first, then @ResponseMessage. */
  const metadata = (message: unknown) =>
    reflector.getAllAndOverride
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(message);

  async function envelope(value: unknown): Promise<Envelope> {
    const result = await firstValueFrom(
      interceptor.intercept(contextWith(), handlerReturning(value)),
    );
    return result as Envelope;
  }

  it('uses the route’s literal message', async () => {
    metadata('Broadcast queued.');

    expect((await envelope({ queued: true })).message).toBe(
      'Broadcast queued.',
    );
  });

  it('falls back to a default when the route sets none', async () => {
    metadata(undefined);

    expect((await envelope(null)).message).toBe('Success');
  });

  /**
   * A route with two outcomes — a broadcast queued now versus one recorded for
   * later — must not claim the wrong one in the envelope, so the message can be
   * resolved from what the handler answered.
   */
  it('asks a resolver what happened, given the handler’s value', async () => {
    metadata((data: { queued: boolean }) =>
      data.queued ? 'Broadcast queued.' : 'Broadcast scheduled.',
    );

    expect((await envelope({ queued: false })).message).toBe(
      'Broadcast scheduled.',
    );
  });
});
