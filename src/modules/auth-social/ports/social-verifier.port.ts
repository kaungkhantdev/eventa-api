import type { socialProviderEnum } from '../../../db/schema';

export type SocialProvider = (typeof socialProviderEnum.enumValues)[number];

/** What a provider asserts about the person, once its token verifies. */
export interface VerifiedIdentity {
  /** The provider's stable subject — the identity key, never the email. */
  subject: string;
  email: string;
  /** Providers only assert an email is theirs when they have verified it. */
  emailVerified: boolean;
  name?: string;
}

/**
 * Verifies a provider's id token (DIP — the consumer owns the port). The
 * implementation checks the signature, issuer, audience and expiry against the
 * provider's JWKS; this service never sees a client secret or a password.
 */
export abstract class SocialVerifierPort {
  abstract verify(
    provider: SocialProvider,
    idToken: string,
  ): Promise<VerifiedIdentity>;
}
