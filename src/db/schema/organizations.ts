import {
  bigint,
  char,
  index,
  numeric,
  pgTable,
  text,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, updatedAt, version } from './_columns';
import { localeEnum } from './enums';

/**
 * Tenant root / workspace. NOT itself tenant-scoped — it is the parent of every
 * tenant table via `organization_id`. Org-level settings (currency, tz, locale,
 * VAT & service-fee rates, statement descriptor, tax id) live here as columns;
 * there is no separate organization_settings table.
 */
export const organizations = pgTable(
  'organizations',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
    name: text().notNull(),
    slug: text().notNull().unique(),
    logoUrl: text(),
    currency: char({ length: 3 }).notNull().default('THB'),
    country: char({ length: 2 }).notNull().default('TH'),
    timezone: text().notNull().default('Asia/Bangkok'),
    locale: localeEnum().notNull().default('en'),
    vatRate: numeric({ precision: 5, scale: 4 }).notNull().default('0.0700'),
    serviceFeeRate: numeric({ precision: 5, scale: 4 })
      .notNull()
      .default('0.0500'),
    statementDescriptor: varchar({ length: 22 }),
    taxId: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    version: version(),
  },
  (t) => [index('ix_organizations_deleted_at').on(t.deletedAt)],
);
