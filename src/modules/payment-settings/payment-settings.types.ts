import { paymentModeEnum } from '../../db/schema';
import type {
  paymentCredentials,
  paymentMethodSettings,
  paymentSettings,
} from '../../db/schema';

export type PaymentSettingsRow = typeof paymentSettings.$inferSelect;
export type PaymentCredentialsRow = typeof paymentCredentials.$inferSelect;
export type PaymentMethodSettingRow = typeof paymentMethodSettings.$inferSelect;
export type PaymentMethod = PaymentMethodSettingRow['method'];
export type PaymentMode = PaymentSettingsRow['mode'];

/** Both modes, in the order the screen offers them. Derived, never re-typed. */
export const PAYMENT_MODES = paymentModeEnum.enumValues;

/** Connect a provider account (US-SET-08). No secret is ever accepted or stored. */
export interface ConnectInput {
  accountId: string;
  /** Browser-safe, and unread: checkout is hosted, so nothing loads Stripe.js. */
  publishableKey?: string;
  mode: PaymentMode;
}

/** Checkout & receipt preferences (US-SET-10). */
export interface UpdatePreferencesInput {
  defaultCurrency?: string;
  statementDescriptor?: string | null;
  saveCards?: boolean;
  emailReceipts?: boolean;
}
