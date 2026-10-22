import { paymentMethodEnum, paymentModeEnum } from '../../db/schema/index';

/** The payment-settings module's named constants. */

export const MODES = paymentModeEnum.enumValues;

/** Well above any real Stripe key; a bound, not a rule. */
export const MAX_KEY = 255;

export const MAX_DESCRIPTOR = 22;

/** The one environment where charging a real card is the intended outcome. */
export const PRODUCTION = 'production';

/** Long enough that a webhook URL cannot be found by guessing. */
export const WEBHOOK_TOKEN_BYTES = 18;

/** Every method the product knows about — derived from the schema enum. */
export const ALL_METHODS = paymentMethodEnum.enumValues;

export const DESCRIPTOR_PATTERN = /^[A-Za-z0-9 .,'-]*$/;

export const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** Both modes, in the order the screen offers them. Derived, never re-typed. */
export const PAYMENT_MODES = paymentModeEnum.enumValues;

export const CONNECTED = 'connected';

/**
 * Stripe encodes the mode in the key itself: `sk_test_…` against `sk_live_…`.
 * Restricted keys (`rk_`) do the same and are a legitimate thing to paste.
 */
export const KEY_SHAPE = /^(?<kind>pk|sk|rk)_(?<mode>test|live)_[A-Za-z0-9]+$/;

/** How much of a stored secret the screen may show: enough to tell keys apart. */
export const VISIBLE_TAIL = 4;

export const MASK = '•'.repeat(VISIBLE_TAIL);

/** `pk_` is designed to be public; the other two authorise real money. */
export const SECRET_KINDS = ['sk', 'rk'];

/** Stripe's shape for an endpoint's signing secret. */
export const WEBHOOK_SECRET_SHAPE = /^whsec_[A-Za-z0-9]+$/;

/**
 * Where this service listens, matching `setGlobalPrefix` in `main.ts` and the
 * route on `PaymentsController`. Named once here because an organizer pastes
 * the result into Stripe by hand: if it drifts from the mapped route, the
 * callback 404s and orders stop settling with nothing on screen to say so.
 */
export const WEBHOOK_PATH = '/api/v1/public/payments/webhook';
