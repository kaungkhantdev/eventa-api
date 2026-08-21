import type { paymentMethodSettings, paymentSettings } from '../../db/schema';

export type PaymentSettingsRow = typeof paymentSettings.$inferSelect;
export type PaymentMethodSettingRow = typeof paymentMethodSettings.$inferSelect;
export type PaymentMethod = PaymentMethodSettingRow['method'];
export type PaymentMode = PaymentSettingsRow['mode'];

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
