import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { organizations, socialIdentities, users } from '../../db/schema';
import type { LoginUser } from '../auth/auth.service';
import type { SocialProvider } from './ports/social-verifier.port';

export interface LinkInput {
  organizationId: number;
  userId: string;
  provider: SocialProvider;
  subject: string;
  email: string;
}

/**
 * Data access for provider links. The lookups run BEFORE a tenant is known (we
 * discover the org from the link), so they are not tenant-scoped — same pattern
 * as the pre-auth sign-in lookups; see the RLS note in the 0002 migration.
 */
@Injectable()
export class AuthSocialRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** The account already linked to this provider subject, if any. */
  async findBySubject(
    provider: SocialProvider,
    subject: string,
  ): Promise<{ userId: string; organizationId: number } | null> {
    const [row] = await this.db
      .select({
        userId: socialIdentities.userId,
        organizationId: socialIdentities.organizationId,
      })
      .from(socialIdentities)
      .where(
        and(
          eq(socialIdentities.provider, provider),
          eq(socialIdentities.subject, subject),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** An existing account for this email in the given audience (and workspace). */
  async findUserByEmail(
    email: string,
    persona: 'admin' | 'attendee',
    orgSlug?: string,
  ): Promise<{ userId: string; organizationId: number } | null> {
    const rows = await this.db
      .select({ userId: users.id, organizationId: users.organizationId })
      .from(users)
      .innerJoin(organizations, eq(organizations.id, users.organizationId))
      .where(
        and(
          eq(users.email, email),
          eq(users.persona, persona),
          isNull(users.deletedAt),
          ...(orgSlug ? [eq(organizations.slug, orgSlug)] : []),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Record the link. Re-linking the same provider updates the stored subject. */
  async link(input: LinkInput): Promise<void> {
    await this.db
      .insert(socialIdentities)
      .values({
        organizationId: input.organizationId,
        userId: input.userId,
        provider: input.provider,
        subject: input.subject,
        email: input.email,
        lastUsedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [socialIdentities.userId, socialIdentities.provider],
        set: {
          subject: input.subject,
          email: input.email,
          lastUsedAt: new Date(),
        },
      });
  }

  async touchLastUsed(
    provider: SocialProvider,
    subject: string,
  ): Promise<void> {
    await this.db
      .update(socialIdentities)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(socialIdentities.provider, provider),
          eq(socialIdentities.subject, subject),
        ),
      );
  }

  /** The user + org pair AuthService needs to open a session. */
  async loadLoginUser(userId: string): Promise<LoginUser | null> {
    const rows = await this.db
      .select({ user: users, org: organizations })
      .from(users)
      .innerJoin(organizations, eq(organizations.id, users.organizationId))
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Create an attendee inside an EXISTING workspace (US-ACC-06). Attendees do not
   * own a workspace — they belong to the one whose portal they signed in at — so
   * this never bootstraps an organization the way organizer sign-up does.
   */
  async createAttendee(
    orgSlug: string,
    name: string,
    email: string,
  ): Promise<{ userId: string; organizationId: number } | null> {
    const [org] = await this.db
      .select({ id: organizations.id })
      .from(organizations)
      .where(
        and(eq(organizations.slug, orgSlug), isNull(organizations.deletedAt)),
      )
      .limit(1);
    if (!org) return null;
    const [user] = await this.db
      .insert(users)
      .values({
        organizationId: org.id,
        name,
        email,
        persona: 'attendee',
        status: 'Active', // the provider already proved the address
      })
      .returning({ id: users.id });
    return { userId: user.id, organizationId: org.id };
  }
}
