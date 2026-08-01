import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import type { AuthContext } from '../auth/auth.types';
import { AuthSessionsRepository } from './auth-sessions.repository';
import type { SessionView } from './auth-sessions.types';

/**
 * "Where am I signed in" (US-SET-04 / US-ACC-09). Every operation is scoped to the
 * CALLER's own sessions — the user id comes from the token, so one member can
 * never list or revoke another's.
 */
@Injectable()
export class AuthSessionsService {
  constructor(private readonly repo: AuthSessionsRepository) {}

  async list(auth: AuthContext): Promise<SessionView[]> {
    const rows = await this.repo.listLive(auth.organizationId, auth.userId);
    return rows.map((row) => ({
      id: row.id,
      device: row.device ?? 'Unknown device',
      ipAddress: row.ipAddress,
      signedInAt: row.createdAt,
      expiresAt: row.expiresAt,
      isCurrent: row.id === auth.sessionId,
    }));
  }

  /**
   * Sign a device out. The current session is refused — you sign out normally
   * instead — which is also why the list marks it and offers no control.
   */
  async revoke(auth: AuthContext, sessionId: string): Promise<void> {
    if (sessionId === auth.sessionId) {
      throw DomainException.validation(
        'This is the device you are using — sign out instead.',
      );
    }
    const revoked = await this.repo.revokeOwn(
      auth.organizationId,
      auth.userId,
      sessionId,
    );
    if (!revoked) {
      throw DomainException.notFound('That session is no longer active.');
    }
  }

  /** Sign out everywhere except here (US-SET-04's bulk action). */
  async revokeOthers(auth: AuthContext): Promise<{ revoked: number }> {
    const revoked = await this.repo.revokeOthers(
      auth.organizationId,
      auth.userId,
      auth.sessionId,
    );
    return { revoked };
  }
}
