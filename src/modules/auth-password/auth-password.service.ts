import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/** Argon2id password hashing (PCI/PDPA — never store or log plaintext). */
@Injectable()
export class PasswordService {
  /** Hash a plaintext password (argon2id by default). */
  hash(plain: string): Promise<string> {
    return hash(plain);
  }

  /** Constant-time verify of a plaintext password against a stored hash. */
  verify(hashed: string, plain: string): Promise<boolean> {
    return verify(hashed, plain);
  }
}
