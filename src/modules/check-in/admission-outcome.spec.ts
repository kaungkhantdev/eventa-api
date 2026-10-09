import { admissionOutcome } from './admission-outcome';

describe('admissionOutcome (US-REG-12)', () => {
  it('calls a scan that inserted an admission', () => {
    expect(admissionOutcome(true)).toBe('admitted');
  });

  it('calls a scan that collided a find of someone already inside', () => {
    // `uq_check_ins_ticket` rejected the second insert, which is the database
    // telling the door this person is already through it.
    expect(admissionOutcome(false)).toBe('already_checked_in');
  });
});
