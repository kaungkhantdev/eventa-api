import {
  bigint,
  boolean,
  char,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, idPk, updatedAt, version } from './_columns';
import { bytea } from './_types';
import {
  paymentConnectionStatusEnum,
  paymentMethodEnum,
  paymentModeEnum,
  paymentProviderEnum,
} from './enums';
import { organizations } from './organizations';

/**
 * A workspace's payment connection and checkout preferences (US-SET-08/09/10) —
 * one row per organization.
 *
 * **PCI SAQ-A:** no card data and **no provider secret key** is ever stored here.
 * The connection is by reference only — the provider's account id plus its
 * publishable key, both non-secret. Charges are made with the platform secret from
 * `ConfigService` acting on behalf of `accountId`, so there is nothing sensitive to
 * show back, mask, or leak.
 */
export const paymentSettings = pgTable(
  'payment_settings',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    provider: paymentProviderEnum().notNull().default('stripe'),
    mode: paymentModeEnum().notNull().default('test'),
    status: paymentConnectionStatusEnum().notNull().default('disconnected'),
    /** The provider's connected-account reference (e.g. Stripe `acct_…`). */
    accountId: text(),
    /** Publishable/publishable-equivalent key — safe to expose to the browser. */
    publishableKey: text(),
    connectedAt: timestamp({ withTimezone: true }),
    disconnectedAt: timestamp({ withTimezone: true }),
    /**
     * The unguessable path segment of this workspace's own webhook URL. Not a
     * credential — every callback still has to carry a valid Stripe signature.
     * It exists because a signature cannot be verified until you know which
     * secret to verify it with, and one shared endpoint cannot tell tenants apart.
     */
    webhookToken: text(),
    /** Currency charged by default; may differ from the org currency (warned, not blocked). */
    defaultCurrency: char({ length: 3 }).notNull().default('THB'),
    /** ≤22 chars — what an attendee sees on their card statement (US-SET-10). */
    statementDescriptor: varchar({ length: 22 }),
    saveCards: boolean().notNull().default(false),
    emailReceipts: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [unique('uq_payment_settings_org').on(t.organizationId)],
);

/**
 * A workspace's own Stripe keys, one row per mode (US-SET-08).
 *
 * A row per mode rather than six columns on `payment_settings`, because the kit's
 * Test/Live toggle swaps between two independent pairs: an organizer keeps test
 * keys while building the event and adds live keys when sales open, and neither
 * should overwrite the other. Mode is data, not schema.
 *
 * **The secret key and the webhook signing secret are write-only.** They are
 * encrypted at rest by `SecretCipher` (AES-256-GCM, the same cipher protecting
 * TOTP seeds) and never decrypted into a response — only into a Stripe client.
 * `publishableKey` is plain because it is designed to be public.
 */
export const paymentCredentials = pgTable(
  'payment_credentials',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    mode: paymentModeEnum().notNull(),
    /** `pk_test_…` / `pk_live_…` — safe to show, safe in a browser. */
    publishableKey: text(),
    /** `sk_…`, encrypted. Never read back to a caller. */
    secretKeyCipher: bytea(),
    /** `whsec_…` from this workspace's own endpoint, encrypted. */
    webhookSecretCipher: bytea(),
    /** Drives the kit's "Last saved …" line. */
    savedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('uq_payment_credentials_org_mode').on(t.organizationId, t.mode),
  ],
);

/** Per-method on/off for checkout (US-SET-09); absent row = disabled. */
export const paymentMethodSettings = pgTable(
  'payment_method_settings',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    method: paymentMethodEnum().notNull(),
    enabled: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('uq_payment_method_settings_org_method').on(
      t.organizationId,
      t.method,
    ),
  ],
);
