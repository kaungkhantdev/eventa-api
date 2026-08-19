import { customType } from 'drizzle-orm/pg-core';

// Postgres types Drizzle has no first-class builder for. Faithful to entities.md.

/** Case-insensitive text (requires the citext extension — see 0000 migration). */
export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

/** IPv4/IPv6 address. */
export const inet = customType<{ data: string }>({
  dataType() {
    return 'inet';
  },
});

/** Raw bytes (e.g. an encrypted TOTP secret). */
export const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea';
  },
});
