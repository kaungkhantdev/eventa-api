import { socialProviderEnum } from '../../db/schema/index';

/** The auth-social module's named constants. */

export const BEARER = 'Bearer';

/** The provider returns this when the person closes the consent screen. */
export const CONSENT_DENIED = 'access_denied';

export const PROVIDERS = socialProviderEnum.enumValues;
