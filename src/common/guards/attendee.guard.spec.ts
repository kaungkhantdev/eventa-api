import type { ExecutionContext } from '@nestjs/common';
import { DomainException } from '../errors/domain.exception';
import { AttendeeGuard } from './attendee.guard';

function contextWith(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const signedIn = (persona: string) => ({
  userId: 'u1',
  organizationId: 1,
  sessionId: 's1',
  persona,
});

/**
 * NFR-SEC-01 / US-ACC-11: organizer and attendee accounts share no login and
 * no session, and access across the boundary is impossible — enforced here,
 * not only by the web's route guards. AdminGuard is the organizer side.
 */
describe('AttendeeGuard', () => {
  const guard = new AttendeeGuard();

  it('lets an attendee through', () => {
    expect(guard.canActivate(contextWith(signedIn('attendee')))).toBe(true);
  });

  it('forbids (403) an organizer token, even for the same email', () => {
    const err = catchFrom(() =>
      guard.canActivate(contextWith(signedIn('admin'))),
    );

    expect(err).toBeInstanceOf(DomainException);
    expect((err as DomainException).getStatus()).toBe(403);
  });

  it('forbids a request with no principal at all', () => {
    expect(
      catchFrom(() => guard.canActivate(contextWith(undefined))),
    ).toBeInstanceOf(DomainException);
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
