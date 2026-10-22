import { localeEnum, users } from '../../db/schema/index';

/** The users module's named constants. */

export const LOCALES = localeEnum.enumValues;

/** Routing key for the "confirm your new email" message (consumed by eventa-worker). */
export const IDENTITY_EMAIL_CHANGE_REQUESTED =
  'identity.email_change_requested';

/** Routing key for the "here is your confirmation code" text (consumed by eventa-worker). */
export const IDENTITY_PHONE_VERIFICATION_REQUESTED =
  'identity.phone_verification_requested';

/** Six digits: what a person will retype off a lock screen without a mistake. */
export const CODE_DIGITS = 6;

export const CODE_CEILING = 10 ** CODE_DIGITS;

export const NOT_A_MOBILE_MESSAGE =
  'Enter a Thai mobile number — for example 0812345678. Eventa can only text Thai mobiles.';

export const ALREADY_CONFIRMED_MESSAGE =
  'That is already the confirmed number on your account.';

export const WRONG_CODE_MESSAGE =
  "That code didn't match. Check the text and retype it.";

export const CODE_GONE_MESSAGE =
  'That code is no longer valid. Ask for a new one and we will text it again.';

export const TOO_MANY_MESSAGE =
  'Too many wrong codes. Ask for a new one and we will text it again.';

export const PROFILE_COLUMNS = {
  id: users.id,
  organizationId: users.organizationId,
  name: users.name,
  email: users.email,
  pendingEmail: users.pendingEmail,
  phone: users.phone,
  phoneVerifiedAt: users.phoneVerifiedAt,
  pendingPhone: users.pendingPhone,
  timezone: users.timezone,
  locale: users.locale,
  avatarUrl: users.avatarUrl,
  city: users.city,
  dateOfBirth: users.dateOfBirth,
  bio: users.bio,
  displayCurrency: users.displayCurrency,
};

/** Clears every trace of a code in flight. */
export const NO_PHONE_CHALLENGE = {
  pendingPhone: null,
  phoneCodeHash: null,
  phoneCodeExpiresAt: null,
  phoneCodeAttempts: 0,
} as const;
