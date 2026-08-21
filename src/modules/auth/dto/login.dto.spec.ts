import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../../auth-password/auth-password.policy';
import { LoginDto } from './login.dto';

const fieldsRefused = (body: Record<string, unknown>): string[] =>
  validateSync(plainToInstance(LoginDto, body)).map((e) => e.property);

const credentials = (over: Record<string, unknown> = {}) => ({
  email: 'someone@acme.test',
  password: 'correct horse battery staple',
  ...over,
});

/**
 * Signing in VERIFIES a password; it does not police one.
 *
 * The distinction is the whole point of this file. A strength rule belongs
 * where a password is chosen — sign-up, reset, change — and `auth-password.
 * policy` is where it lives. Repeating it here would:
 *
 *  · lock people out. The minimum for choosing is PASSWORD_MIN_LENGTH; a login
 *    form demanding more refuses a password this very API issued, and says the
 *    input is malformed rather than wrong, so nobody would think to reset it.
 *  · answer a question nobody signed in to ask. A refusal shaped like "must be
 *    at least N characters" tells an unauthenticated caller the policy, which
 *    is free reconnaissance for anyone guessing.
 *  · split one failure into two. A short password would be refused before the
 *    credentials were ever read — a different status, a different body and a
 *    different response time from a wrong one.
 */
describe('LoginDto', () => {
  it('accepts the credentials of somebody signing in normally', () => {
    expect(fieldsRefused(credentials())).toEqual([]);
  });

  describe('the password field', () => {
    it('accepts one shorter than the policy for CHOOSING a password', () => {
      const tooShortToChoose = 'a1'.repeat(1);
      expect(tooShortToChoose.length).toBeLessThan(PASSWORD_MIN_LENGTH);

      expect(
        fieldsRefused(credentials({ password: tooShortToChoose })),
      ).toEqual([]);
    });

    // The one this repo actually shipped: registrable at 6, unusable at 6.
    it('accepts one exactly as long as sign-up allows', () => {
      const justLongEnoughToRegister =
        'a'.repeat(PASSWORD_MIN_LENGTH - 1) + '1';

      expect(
        fieldsRefused(credentials({ password: justLongEnoughToRegister })),
      ).toEqual([]);
    });

    it('accepts one with no digit or letter rule applied', () => {
      expect(fieldsRefused(credentials({ password: '        ' }))).toEqual([]);
    });

    it('still refuses an empty one — nothing was submitted to check', () => {
      expect(fieldsRefused(credentials({ password: '' }))).toContain(
        'password',
      );
    });

    /**
     * A bound stays, but as a resource guard rather than a policy: hashing is
     * deliberately slow, so an unbounded body is a way to spend the server's
     * CPU without an account.
     */
    it('refuses one far beyond any real password', () => {
      expect(
        fieldsRefused(credentials({ password: 'x'.repeat(5_000) })),
      ).toContain('password');
    });
  });
});
