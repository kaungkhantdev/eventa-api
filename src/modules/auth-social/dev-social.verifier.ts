import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';
import {
  SocialVerifierPort,
  type SocialProvider,
  type VerifiedIdentity,
} from './ports/social-verifier.port';

/**
 * Dev/test identity verifier. It accepts a **base64url JSON** stand-in for a real
 * id token so the flow can be exercised end to end without live provider apps,
 * and refuses to run at all outside development — a production boot must bind a
 * real adapter (Google/Apple/LinkedIn JWKS) instead.
 *
 * A real adapter verifies signature, issuer, audience and expiry against the
 * provider's published keys; it, too, never sees a password or client secret from
 * the browser.
 */
@Injectable()
export class DevSocialVerifier extends SocialVerifierPort {
  private readonly logger = new Logger('SocialVerifier');

  constructor(private readonly config: ConfigService<Env, true>) {
    super();
  }

  verify(provider: SocialProvider, idToken: string): Promise<VerifiedIdentity> {
    if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
      throw new Error(
        'DevSocialVerifier must not be used in production — bind a real provider adapter.',
      );
    }
    const claims = JSON.parse(
      Buffer.from(idToken, 'base64url').toString('utf8'),
    ) as Partial<VerifiedIdentity>;
    if (!claims.subject || !claims.email) {
      throw new Error('Token is missing subject or email');
    }
    this.logger.debug({ provider }, 'Verified social identity (dev verifier)');
    return Promise.resolve({
      subject: claims.subject,
      email: claims.email,
      emailVerified: claims.emailVerified ?? true,
      name: claims.name,
    });
  }
}
