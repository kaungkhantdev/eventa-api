import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import {
  discountCodes,
  discountRedemptions,
  organizations,
} from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type {
  DiscountRow,
  DiscountStatus,
  NewDiscountValues,
  SearchDiscountsOptions,
} from './discounts.types';

const DEFAULT_VAT_RATE = 0.07;

/** Data access for the Promotions context. Every read/write is tenant-scoped. */
@Injectable()
export class DiscountsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async insert(values: NewDiscountValues): Promise<DiscountRow> {
    return withTenant(this.db, values.organizationId, async (tx) => {
      const [row] = await tx.insert(discountCodes).values(values).returning();
      return row;
    });
  }

  /** A live code by id within the workspace. */
  async findById(
    organizationId: number,
    id: string,
  ): Promise<DiscountRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select()
        .from(discountCodes)
        .where(
          and(
            eq(discountCodes.id, id),
            eq(discountCodes.organizationId, organizationId),
            isNull(discountCodes.deletedAt),
          ),
        )
        .limit(1);
      return row ?? null;
    });
  }

  /**
   * Match a code the buyer typed, for this event or workspace-wide. Codes are
   * stored uppercase, so the caller normalises and matching is exact.
   */
  async findUsable(
    organizationId: number,
    code: string,
    eventId: string,
  ): Promise<DiscountRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select()
        .from(discountCodes)
        .where(
          and(
            eq(discountCodes.organizationId, organizationId),
            eq(discountCodes.code, code),
            isNull(discountCodes.deletedAt),
            or(
              isNull(discountCodes.eventId),
              eq(discountCodes.eventId, eventId),
            ),
          ),
        )
        // An event-specific code wins over a workspace-wide one of the same name.
        .orderBy(desc(discountCodes.eventId))
        .limit(1);
      return row ?? null;
    });
  }

  /** Is this code text already taken in the workspace (optionally excluding one)? */
  async codeExists(
    organizationId: number,
    code: string,
    eventId: string | null,
    excludeId?: string,
  ): Promise<boolean> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({ id: discountCodes.id })
        .from(discountCodes)
        .where(
          and(
            eq(discountCodes.organizationId, organizationId),
            eq(discountCodes.code, code),
            eventId === null
              ? isNull(discountCodes.eventId)
              : eq(discountCodes.eventId, eventId),
            isNull(discountCodes.deletedAt),
          ),
        );
      return rows.some((r) => r.id !== excludeId);
    });
  }

  /** Every code text in use — the generator avoids all of them in one round-trip. */
  async allCodes(organizationId: number): Promise<Set<string>> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({ code: discountCodes.code })
        .from(discountCodes)
        .where(eq(discountCodes.organizationId, organizationId));
      return new Set(rows.map((r) => r.code));
    });
  }

  /** Optimistic update; null when no row matched (concurrent change) → 409. */
  async update(
    organizationId: number,
    id: string,
    values: Partial<NewDiscountValues>,
    currentVersion: number,
  ): Promise<DiscountRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .update(discountCodes)
        .set({ ...values, version: currentVersion + 1, updatedAt: new Date() })
        .where(
          and(
            eq(discountCodes.id, id),
            eq(discountCodes.organizationId, organizationId),
            eq(discountCodes.version, currentVersion),
            isNull(discountCodes.deletedAt),
          ),
        )
        .returning();
      return row ?? null;
    });
  }

  async softDelete(organizationId: number, id: string): Promise<boolean> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .update(discountCodes)
        .set({ deletedAt: new Date(), status: 'disabled' })
        .where(
          and(
            eq(discountCodes.id, id),
            eq(discountCodes.organizationId, organizationId),
            isNull(discountCodes.deletedAt),
          ),
        )
        .returning({ id: discountCodes.id });
      return rows.length > 0;
    });
  }

  /** Only ever called for a code that was never redeemed (US-TKT-09). */
  async hardDelete(organizationId: number, id: string): Promise<boolean> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .delete(discountCodes)
        .where(
          and(
            eq(discountCodes.id, id),
            eq(discountCodes.organizationId, organizationId),
            eq(discountCodes.used, 0),
          ),
        )
        .returning({ id: discountCodes.id });
      return rows.length > 0;
    });
  }

  /** A filtered page of the workspace's codes, newest first, plus the total. */
  async search(
    organizationId: number,
    opts: SearchDiscountsOptions,
  ): Promise<{ items: DiscountRow[]; total: number }> {
    const where = this.searchWhere(organizationId, opts);
    return withTenant(this.db, organizationId, async (tx) => {
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(discountCodes)
        .where(where);
      const items = await tx
        .select()
        .from(discountCodes)
        .where(where)
        .orderBy(desc(discountCodes.createdAt), asc(discountCodes.id))
        .limit(opts.limit)
        .offset(opts.offset);
      return { items, total: count };
    });
  }

  /** How many times this buyer has already redeemed this code. */
  async redemptionsByBuyer(
    organizationId: number,
    discountCodeId: string,
    buyerEmail: string,
  ): Promise<number> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(discountRedemptions)
        .where(
          and(
            eq(discountRedemptions.organizationId, organizationId),
            eq(discountRedemptions.discountCodeId, discountCodeId),
            eq(discountRedemptions.buyerEmail, buyerEmail),
          ),
        );
      return row.count;
    });
  }

  /** Codes whose derived status has drifted from what is stored (US-TKT-10). */
  async syncStatuses(
    organizationId: number,
    changes: { id: string; status: DiscountStatus }[],
  ): Promise<void> {
    if (changes.length === 0) return;
    await withTenant(this.db, organizationId, async (tx) => {
      for (const change of changes) {
        await tx
          .update(discountCodes)
          .set({ status: change.status })
          .where(
            and(
              eq(discountCodes.id, change.id),
              eq(discountCodes.organizationId, organizationId),
            ),
          );
      }
    });
  }

  /** The org's VAT rate (numeric string → number); default 7% if unset. */
  async orgVatRate(organizationId: number): Promise<number> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ vatRate: organizations.vatRate })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      return row ? Number(row.vatRate) : DEFAULT_VAT_RATE;
    });
  }

  private searchWhere(organizationId: number, opts: SearchDiscountsOptions) {
    return and(
      eq(discountCodes.organizationId, organizationId),
      isNull(discountCodes.deletedAt),
      opts.status ? eq(discountCodes.status, opts.status) : undefined,
      // Filtering by event keeps workspace-wide codes: they apply there too.
      opts.eventId
        ? or(
            eq(discountCodes.eventId, opts.eventId),
            isNull(discountCodes.eventId),
          )
        : undefined,
      opts.search
        ? or(
            ilike(discountCodes.code, `%${opts.search}%`),
            opts.eventIds && opts.eventIds.length > 0
              ? inArray(discountCodes.eventId, opts.eventIds)
              : undefined,
          )
        : undefined,
    );
  }
}
