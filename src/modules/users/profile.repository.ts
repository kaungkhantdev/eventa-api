import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, ne, or } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { users } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type { ProfileRow } from './users.types';

const PROFILE_COLUMNS = {
  id: users.id,
  organizationId: users.organizationId,
  name: users.name,
  email: users.email,
  pendingEmail: users.pendingEmail,
  phone: users.phone,
  timezone: users.timezone,
  locale: users.locale,
  avatarUrl: users.avatarUrl,
  city: users.city,
  dateOfBirth: users.dateOfBirth,
  bio: users.bio,
  displayCurrency: users.displayCurrency,
};

/** Data access for a member's own profile (US-SET-01). */
@Injectable()
export class ProfileRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async find(
    organizationId: number,
    userId: string,
  ): Promise<ProfileRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select(PROFILE_COLUMNS)
        .from(users)
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .limit(1);
      return row ?? null;
    });
  }

  async update(
    organizationId: number,
    userId: string,
    values: Partial<ProfileRow>,
  ): Promise<ProfileRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning(PROFILE_COLUMNS);
      return row ?? null;
    });
  }

  /** Is this address already a console account here (excluding me)? */
  async emailTaken(
    organizationId: number,
    userId: string,
    email: string,
  ): Promise<boolean> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.organizationId, organizationId),
            ne(users.id, userId),
            isNull(users.deletedAt),
            or(eq(users.email, email), eq(users.pendingEmail, email)),
          ),
        )
        .limit(1);
      return row !== undefined;
    });
  }

  /** Promote the confirmed address and clear the pending one, atomically. */
  async promoteEmail(
    organizationId: number,
    userId: string,
    email: string,
  ): Promise<ProfileRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ email, pendingEmail: null, updatedAt: new Date() })
        .where(and(eq(users.id, userId), eq(users.pendingEmail, email)))
        .returning(PROFILE_COLUMNS);
      return row ?? null;
    });
  }
}
