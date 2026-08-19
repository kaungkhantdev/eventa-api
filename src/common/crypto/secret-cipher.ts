import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { Env } from '../../config/env.validation';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16;

/**
 * Authenticated encryption for secrets that must be recoverable — today the TOTP
 * seed (US-SET-03), which has to be read back to verify a code, so it cannot be
 * hashed. Stored as `iv | authTag | ciphertext`; the GCM tag means tampering is
 * detected on decrypt rather than silently producing garbage.
 *
 * Passwords are NOT encrypted with this — they are hashed (argon2, one-way).
 */
@Injectable()
export class SecretCipher {
  private readonly key: Buffer;

  constructor(config: ConfigService<Env, true>) {
    const encoded: string = config.getOrThrow('SECRET_ENCRYPTION_KEY', {
      infer: true,
    });
    this.key = Buffer.from(encoded, 'base64');
  }

  encrypt(plaintext: string): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const body = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  }

  decrypt(payload: Buffer): string {
    const iv = payload.subarray(0, IV_BYTES);
    const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const body = payload.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString(
      'utf8',
    );
  }

  /** Constant-time compare, so a recovery-code check can't be timed. */
  static equals(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
