import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { authSessions, users } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type { Persona } from '../auth/auth.types';

export interface PasswordUser {
  id: string;
  organizationId: number;
  name: string;
  status: string;
  passwordHash: string | null;
}

/** Data access for password reset (US-ACC-04) and change (US-ACC-05). */
@Injectable()
export class PasswordRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Find an account by email + audience (pre-auth; used by forgot-password). */
  async findByEmailPersona(
    email: string,
    persona: Persona,
  ): Promise<PasswordUser | null> {
    const [row] = await this.db
      .select({
        id: users.id,
        organizationId: users.organizationId,
        name: users.name,
        status: users.status,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(
        and(
          eq(users.email, email),
          eq(users.persona, persona),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** The current password hash for a signed-in user (used by change-password). */
  async currentHash(
    organizationId: number,
    userId: string,
  ): Promise<string | null> {
    const [row] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(
        and(
          eq(users.id, userId),
          eq(users.organizationId, organizationId),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    return row?.passwordHash ?? null;
  }

  /**
   * Set a new password and sign out sessions. `keepSessionId` stays signed in
   * (change-password keeps the current device); omit it to revoke every session
   * (reset signs out everywhere).
   */
  async setPassword(
    organizationId: number,
    userId: string,
    passwordHash: string,
    keepSessionId?: string,
  ): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, userId));
      await tx
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(authSessions.userId, userId),
            isNull(authSessions.revokedAt),
            keepSessionId ? ne(authSessions.id, keepSessionId) : undefined,
          ),
        );
    });
  }
}
