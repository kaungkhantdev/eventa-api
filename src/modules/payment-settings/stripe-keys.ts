import { DomainException } from '../../common/errors/domain.exception';
import type { PaymentMode } from './payment-settings.types';

/**
 * Stripe encodes the mode in the key itself: `sk_test_…` against `sk_live_…`.
 * Restricted keys (`rk_`) do the same and are a legitimate thing to paste.
 */
const KEY_SHAPE = /^(?<kind>pk|sk|rk)_(?<mode>test|live)_[A-Za-z0-9]+$/;

/** How much of a stored secret the screen may show: enough to tell keys apart. */
const VISIBLE_TAIL = 4;
const MASK = '•'.repeat(VISIBLE_TAIL);

/** `pk_` is designed to be public; the other two authorise real money. */
const SECRET_KINDS = ['sk', 'rk'];

export function modeOfKey(key: string): PaymentMode | null {
  const mode = KEY_SHAPE.exec(key.trim())?.groups?.mode;
  return mode === 'test' || mode === 'live' ? mode : null;
}

function kindOfKey(key: string): string | null {
  return KEY_SHAPE.exec(key.trim())?.groups?.kind ?? null;
}

/**
 * Refuse a key pair that disagrees with the toggle above it, or with itself
 * (US-SET-08).
 *
 * Stripe will not catch this for us — both keys are perfectly valid, just for
 * the wrong world — and the failure is silent and expensive in both directions.
 * Live keys saved under "Test" take real money from real people while the banner
 * says no real charges are processed. Test keys saved under "Live" decline every
 * buyer at an event that has already opened sales.
 *
 * The field check matters just as much: `publishableKey` is returned to the page
 * by design, so a secret key pasted into that box would be shown back and cached
 * wherever that response travels.
 */
export function assertKeysMatchMode(
  mode: PaymentMode,
  publishableKey: string,
  secretKey: string,
): void {
  assertKind(publishableKey, 'pk', 'publishable key');
  assertSecretKind(secretKey);

  const found = modeOfKey(publishableKey);
  if (found !== mode) throw wrongMode('publishable key', mode, found);

  const secretMode = modeOfKey(secretKey);
  if (secretMode !== mode) throw wrongMode('secret key', mode, secretMode);
}

function assertKind(key: string, expected: string, label: string): void {
  const kind = kindOfKey(key);
  if (kind === null) {
    throw DomainException.invalidField(
      fieldOf(label),
      `That does not look like a Stripe ${label}. Copy it from your Stripe Dashboard under Developers → API keys.`,
    );
  }
  if (kind !== expected) {
    throw DomainException.invalidField(
      fieldOf(label),
      `That is a ${nameOfKind(kind)}, not a ${label}. Check the two boxes are not swapped.`,
    );
  }
}

/** The secret box accepts a full secret key or a restricted one, nothing else. */
function assertSecretKind(key: string): void {
  const kind = kindOfKey(key);
  if (kind === null) {
    throw DomainException.invalidField(
      'secretKey',
      'That does not look like a Stripe secret key. Copy it from your Stripe Dashboard under Developers → API keys.',
    );
  }
  if (!SECRET_KINDS.includes(kind)) {
    throw DomainException.invalidField(
      'secretKey',
      `That is a ${nameOfKind(kind)}, not a secret key. Check the two boxes are not swapped.`,
    );
  }
}

function wrongMode(
  label: string,
  wanted: PaymentMode,
  found: PaymentMode | null,
): DomainException {
  const suffix =
    found === null
      ? ''
      : ` — that is a ${found} key. Switch the toggle to ${found}, or paste your ${wanted} key.`;
  return DomainException.invalidField(
    fieldOf(label),
    `This is ${wanted} mode, so both keys must be ${wanted} keys${suffix}`,
  );
}

function nameOfKind(kind: string): string {
  if (kind === 'pk') return 'publishable key';
  if (kind === 'rk') return 'restricted key';
  return 'secret key';
}

function fieldOf(label: string): string {
  return label === 'publishable key' ? 'publishableKey' : 'secretKey';
}

/**
 * What the screen shows in place of a stored secret — never the secret, and
 * never enough of it to use. The last four answer the only question the page
 * has to: *which* key is saved.
 */
export function maskedTail(secret: string | null): string {
  if (!secret) return '';
  if (secret.length <= VISIBLE_TAIL) return MASK;
  return `${MASK}${secret.slice(-VISIBLE_TAIL)}`;
}
