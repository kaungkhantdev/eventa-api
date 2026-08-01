import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { recoveryCodes, twoFactors, users } from '../../db/schema';
import { withTenant } from '../../db/tenant';

export type TwoFactorRow = typeof twoFactors.$inferSelect;

/** Data access for TOTP enrolment and its one-time recovery codes. */
@Injectable()
export class AuthTwoFactorRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async find(
    organizationId: number,
    userId: string,
  ): Promise<TwoFactorRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select()
        .from(twoFactors)
        .where(eq(twoFactors.userId, userId))
        .limit(1);
      return row ?? null;
    });
  }

  /** Start (or restart) enrolment — an unconfirmed row is simply replaced. */
  async upsertPending(
    organizationId: number,
    userId: string,
    secretEncrypted: Buffer,
    otpauthUri: string,
  ): Promise<TwoFactorRow> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .insert(twoFactors)
        .values({ organizationId, userId, secretEncrypted, otpauthUri })
        .onConflictDoUpdate({
          target: twoFactors.userId,
          set: {
            secretEncrypted,
            otpauthUri,
            confirmedAt: null,
            updatedAt: new Date(),
          },
        })
        .returning();
      return row;
    });
  }

  /** Confirm enrolment and flip the user's flag in one transaction. */
  async confirm(
    organizationId: number,
    userId: string,
    twoFactorId: number,
    codeHashes: string[],
    at: Date,
  ): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .update(twoFactors)
        .set({ confirmedAt: at, updatedAt: at })
        .where(eq(twoFactors.id, twoFactorId));
      await tx
        .update(users)
        .set({ twoFactorEnabled: true, updatedAt: at })
        .where(eq(users.id, userId));
      await tx
        .delete(recoveryCodes)
        .where(eq(recoveryCodes.twoFactorId, twoFactorId));
      await tx
        .insert(recoveryCodes)
        .values(codeHashes.map((codeHash) => ({ twoFactorId, codeHash })));
    });
  }

  /** Turn it off: the enrolment and its codes go, the user flag clears. */
  async disable(
    organizationId: number,
    userId: string,
    twoFactorId: number,
  ): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .delete(recoveryCodes)
        .where(eq(recoveryCodes.twoFactorId, twoFactorId));
      await tx.delete(twoFactors).where(eq(twoFactors.id, twoFactorId));
      await tx
        .update(users)
        .set({ twoFactorEnabled: false, updatedAt: new Date() })
        .where(eq(users.id, userId));
    });
  }

  /** Replace the whole set — regenerating invalidates every old code. */
  async replaceRecoveryCodes(
    organizationId: number,
    twoFactorId: number,
    codeHashes: string[],
  ): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .delete(recoveryCodes)
        .where(eq(recoveryCodes.twoFactorId, twoFactorId));
      await tx
        .insert(recoveryCodes)
        .values(codeHashes.map((codeHash) => ({ twoFactorId, codeHash })));
    });
  }

  /** Spend an unused recovery code; false if it doesn't match or was used. */
  async consumeRecoveryCode(
    organizationId: number,
    twoFactorId: number,
    codeHash: string,
  ): Promise<boolean> {
    const rows = await withTenant(this.db, organizationId, (tx) =>
      tx
        .update(recoveryCodes)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(recoveryCodes.twoFactorId, twoFactorId),
            eq(recoveryCodes.codeHash, codeHash),
            isNull(recoveryCodes.usedAt),
          ),
        )
        .returning({ id: recoveryCodes.id }),
    );
    return rows.length > 0;
  }

  async countUnusedCodes(
    organizationId: number,
    twoFactorId: number,
  ): Promise<number> {
    const rows = await withTenant(this.db, organizationId, (tx) =>
      tx
        .select({ id: recoveryCodes.id })
        .from(recoveryCodes)
        .where(
          and(
            eq(recoveryCodes.twoFactorId, twoFactorId),
            isNull(recoveryCodes.usedAt),
          ),
        ),
    );
    return rows.length;
  }
}
