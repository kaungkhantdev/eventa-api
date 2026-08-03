import { randomInt } from 'node:crypto';

/** Crockford base32 minus I, L, O, U — no character a person can mis-copy. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 8;
const PREFIX = 'ORD';

/**
 * A booking reference an attendee can read down a phone line: `ORD-7K2M9QX4`.
 *
 * Random rather than sequential on purpose — a sequence would leak how many
 * orders a workspace has taken, and let anyone guess the reference next to
 * theirs. 32^8 ≈ 1.1e12 keeps collisions rare; `uq_orders_org_reference` catches
 * the rest, and the caller retries.
 */
export function generateOrderReference(): string {
  let body = '';
  for (let i = 0; i < LENGTH; i += 1) {
    body += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `${PREFIX}-${body}`;
}

/**
 * The bearer token printed into a ticket's QR. High-entropy and opaque: check-in
 * looks it up rather than verifying a signature, so there is no key to rotate and
 * a revoked ticket is revoked the instant its row changes.
 */
export function generateQrToken(): string {
  let token = '';
  for (let i = 0; i < QR_TOKEN_LENGTH; i += 1) {
    token += ALPHABET[randomInt(ALPHABET.length)];
  }
  return token;
}

/** 32^24 ≈ 1.3e36 — unguessable at any scale a scanner could be brute-forced at. */
const QR_TOKEN_LENGTH = 24;
