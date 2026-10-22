import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idPk, updatedAt } from './_columns';
import { bytea, citext } from './_types';
import { calendarConnectionStatusEnum } from './enums';
import { users } from './identity';
import { organizations } from './organizations';

/**
 * The workspace's Google Calendar connection (E12, US-MTG-08) — one row per
 * organization, and no row means disconnected.
 *
 * **The refresh token and the PKCE verifier are write-only.** Both are
 * encrypted at rest by `SecretCipher` (AES-256-GCM, `iv | tag | ciphertext`)
 * and never decrypted into a response: the token only into a call to Google
 * (eventa-api to revoke it, eventa-worker to mint access tokens), the verifier
 * only into the one code exchange it was made for. Access tokens are never
 * stored at all.
 *
 * The `oauth_state_*` columns hold ONE pending connect: a SHA-256 of the
 * random nonce in the `state` Google echoes back (never the nonce itself), who
 * started it, and when it lapses. They are cleared on the first matching
 * callback, which is what makes the state single-use.
 */
export const calendarConnections = pgTable(
  'calendar_connections',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    status: calendarConnectionStatusEnum().notNull().default('disconnected'),
    /** The Google account that granted access — shown to Admins only. */
    accountEmail: citext(),
    /** The OAuth refresh token, encrypted. Never read back to a caller. */
    refreshTokenCipher: bytea(),
    /** Who completed the connect; kept when that account is removed. */
    connectedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    connectedAt: timestamp({ withTimezone: true }),
    disconnectedAt: timestamp({ withTimezone: true }),
    /** sha256 hex of the pending connect's nonce. */
    oauthStateHash: text(),
    /**
     * Who started the pending connect, re-checked for Manage integrations at
     * the callback. Deliberately NOT a foreign key: it lives ten minutes at
     * most and is cleared on first use, so there is nothing to keep it
     * consistent with.
     */
    oauthStateUserId: uuid(),
    /** The pending PKCE code_verifier, encrypted. */
    oauthVerifierCipher: bytea(),
    oauthStateExpiresAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('uq_calendar_connections_org').on(t.organizationId),
    check(
      'ck_calendar_connections_token',
      sql`${t.status} <> 'connected' OR ${t.refreshTokenCipher} IS NOT NULL`,
    ),
  ],
);
