import { toThaiMobileE164 } from './thai-mobile';

const E164 = '+66812345678';

describe('toThaiMobileE164 (US-DISC-11 AC3)', () => {
  it.each([
    ['0812345678', E164],
    ['+66812345678', E164],
    ['66812345678', E164],
    ['0066812345678', E164],
    ['+660812345678', E164],
    ['081 234 5678', E164],
    ['081-234-5678', E164],
    ['(081) 234.5678', E164],
    ['0612345678', '+66612345678'],
    ['0912345678', '+66912345678'],
  ])('normalises %s', (raw, expected) => {
    expect(toThaiMobileE164(raw)).toBe(expected);
  });

  it.each([
    ['021234567', 'a Bangkok landline'],
    ['0381234567', 'a provincial landline'],
    ['081234567', 'a digit short'],
    ['08123456789', 'a digit long'],
    ['+6581234567', 'a Singapore number'],
    ['+14155550123', 'a US number'],
    ['not a phone', 'free text'],
    ['', 'nothing at all'],
    ['+66', 'a country code and no subscriber'],
  ])('refuses %s (%s)', (raw) => {
    expect(toThaiMobileE164(raw)).toBeNull();
  });
});
