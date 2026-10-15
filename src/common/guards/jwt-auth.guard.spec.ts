import { UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { RequestContextService } from '../context/request-context';
import { DomainException } from '../errors/domain.exception';
import { JwtAuthGuard } from './jwt-auth.guard';

const principal = {
  userId: 'u1',
  organizationId: 7,
  sessionId: 's1',
  persona: 'admin' as const,
};

describe('JwtAuthGuard.handleRequest', () => {
  let context: jest.Mocked<Pick<RequestContextService, 'set'>>;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    context = { set: jest.fn() };
    guard = new JwtAuthGuard(
      {} as Reflector,
      context as unknown as RequestContextService,
    );
  });

  it('stamps the principal onto the request context', () => {
    expect(guard.handleRequest(null, principal)).toBe(principal);
    expect(context.set).toHaveBeenCalledWith({
      organizationId: 7,
      userId: 'u1',
    });
  });

  it('answers 401 when there is no principal', () => {
    const err = catchFrom(() => guard.handleRequest(null, false));

    expect(err).toBeInstanceOf(DomainException);
    expect((err as DomainException).getStatus()).toBe(401);
  });

  it('answers 401 when the token was refused', () => {
    const err = catchFrom(() =>
      guard.handleRequest(new UnauthorizedException(), false),
    );

    expect((err as DomainException).getStatus()).toBe(401);
  });

  /**
   * Checking a token now reads its session. If that read cannot happen, the
   * token has not been judged at all: a 401 would tell the client its session
   * is over, and the client would end it — signing everybody out over a
   * database blip. The failure surfaces as what it is instead.
   */
  it('lets a failure to check the token through rather than calling it a 401', () => {
    const outage = new Error('connection terminated');

    expect(catchFrom(() => guard.handleRequest(outage, false))).toBe(outage);
    expect(context.set).not.toHaveBeenCalled();
  });
});

function catchFrom(run: () => unknown): unknown {
  try {
    run();
  } catch (err) {
    return err;
  }
  throw new Error('expected a throw');
}
