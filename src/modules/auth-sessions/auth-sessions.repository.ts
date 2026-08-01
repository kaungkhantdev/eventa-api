import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { authSessions } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type { SessionRow } from './auth-sessions.types';

/** Data access for a member's live sign-in sessions. */
@Injectable()
export class AuthSessionsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Live (unrevoked, unexpired) sessions for this member, newest first. */
  listLive(organizationId: number, userId: string): Promise<SessionRow[]> {
    return withTenant(this.db, organizationId, (tx) =>
      tx
        .select()
        .from(authSessions)
        .where(
          and(
            eq(authSessions.organizationId, organizationId),
            eq(authSessions.userId, userId),
            isNull(authSessions.revokedAt),
            gt(authSessions.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(authSessions.createdAt)),
    );
  }

  /** Revoke one of MY sessions; returns false if it isn't mine or is already gone. */
  async revokeOwn(
    organizationId: number,
    userId: string,
    sessionId: string,
  ): Promise<boolean> {
    const rows = await withTenant(this.db, organizationId, (tx) =>
      tx
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(authSessions.id, sessionId),
            eq(authSessions.organizationId, organizationId),
            eq(authSessions.userId, userId),
            isNull(authSessions.revokedAt),
          ),
        )
        .returning({ id: authSessions.id }),
    );
    return rows.length > 0;
  }

  /** Revoke every session of mine except the one I'm using. */
  async revokeOthers(
    organizationId: number,
    userId: string,
    keepSessionId: string,
  ): Promise<number> {
    const rows = await withTenant(this.db, organizationId, (tx) =>
      tx
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(authSessions.organizationId, organizationId),
            eq(authSessions.userId, userId),
            ne(authSessions.id, keepSessionId),
            isNull(authSessions.revokedAt),
          ),
        )
        .returning({ id: authSessions.id }),
    );
    return rows.length;
  }
}
