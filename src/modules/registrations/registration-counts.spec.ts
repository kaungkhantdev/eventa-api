import { orderStatusEnum } from '../../db/schema';
import { tallyByStatus, type StatusTally } from './registration-counts';
import type { RegistrationStatus } from './registrations.types';

const tally = (status: RegistrationStatus, count: number): StatusTally => ({
  status,
  count,
});

describe('the queue tab totals (US-REG-01)', () => {
  it('seeds a bucket for every status the column can hold', () => {
    // A tab that matches nothing has to read 0, not blank — and the list of
    // buckets comes from the enum rather than being typed out, so a status
    // added to the database cannot be left without one.
    const counts = tallyByStatus([]);
    for (const status of orderStatusEnum.enumValues) {
      expect(counts[status]).toBe(0);
    }
    expect(counts.all).toBe(0);
  });

  it('counts an expired registration under its own status', () => {
    expect(tallyByStatus([tally('expired', 3)]).expired).toBe(3);
  });

  it('totals every row for All, including statuses with no tab of their own', () => {
    // The defect this replaces: All was the sum of five named buckets, so the
    // three expired orders it still listed were in nobody's count and the
    // pill read smaller than the table beneath it.
    const counts = tallyByStatus([
      tally('pending', 12),
      tally('confirmed', 30),
      tally('waitlisted', 4),
      tally('cancelled', 2),
      tally('rejected', 1),
      tally('expired', 3),
    ]);
    expect(counts.all).toBe(52);
  });

  it('still totals a status this build has never heard of', () => {
    // The whole point of counting rather than summing names: a seventh
    // `order_status` shipped in a migration ahead of this code is listed by
    // `page()`, so it must be in All, and All must not wait for somebody to
    // remember to add a bucket for it.
    const unknown = { status: 'disputed' as RegistrationStatus, count: 7 };
    const counts = tallyByStatus([tally('confirmed', 30), unknown]);
    expect(counts.all).toBe(37);
  });

  it('reports no bucket for a status outside the enum, so the shape stays the DTO', () => {
    // It is counted in All but given no field of its own: `RegistrationCountsDto`
    // is the published contract, and inventing a key at runtime would make the
    // response disagree with openapi.json.
    const counts = tallyByStatus([
      { status: 'disputed' as RegistrationStatus, count: 7 },
    ]);
    expect(Object.keys(counts).sort()).toEqual(
      ['all', ...orderStatusEnum.enumValues].sort(),
    );
  });
});
