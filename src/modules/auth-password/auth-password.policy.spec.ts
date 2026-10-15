import { type ClassConstructor, plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AcceptInviteDto } from '../auth/dto/accept-invite.dto';
import { RegisterDto } from '../auth-signup/dto/register.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PASSWORD_MIN_LENGTH } from './auth-password.policy';

/** Every place a password is CHOSEN, and the field each one chooses it in. */
const SURFACES: [string, ClassConstructor<object>, string][] = [
  ['sign-up', RegisterDto, 'password'],
  ['reset', ResetPasswordDto, 'newPassword'],
  ['change', ChangePasswordDto, 'newPassword'],
  ['accept-invite', AcceptInviteDto, 'password'],
];

/**
 * US-SET-02: a strong password is "at least 8 characters with a number and a
 * symbol" — the one standard for every surface where a password is chosen
 * (US-ACC-01 note). Signing in never polices it (see login.dto.spec).
 */
describe.each(SURFACES)('the password rule at %s', (_name, Dto, field) => {
  const refused = (password: string): boolean =>
    validateSync(plainToInstance(Dto, { [field]: password })).some(
      (e) => e.property === field,
    );

  it('holds the floor at 8 characters', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(refused('ab1!xyz')).toBe(true);
    expect(refused('ab1!wxyz')).toBe(false);
  });

  it('refuses one with no symbol', () => {
    expect(refused('abc123')).toBe(true);
    expect(refused('password1')).toBe(true);
  });

  it('refuses one with no number', () => {
    expect(refused('password!')).toBe(true);
  });

  it('asks for no letter — a number and a symbol are the rule', () => {
    expect(refused('12345678!')).toBe(false);
  });

  it('accepts a strong one', () => {
    expect(refused('Passw0rd!')).toBe(false);
  });

  // A space is a symbol, so a passphrase with a number meets the rule.
  it('accepts a passphrase with a number', () => {
    expect(refused('a brand new longer password 9')).toBe(false);
  });

  // A Thai letter or vowel sign is a letter, not a symbol.
  it('does not count Thai letters as the symbol', () => {
    expect(refused('สวัสดีครับ1')).toBe(true);
    expect(refused('สวัสดีครับ1!')).toBe(false);
  });
});
