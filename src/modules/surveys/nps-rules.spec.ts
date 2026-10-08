import { summariseNps } from './nps-rules';

describe('the net promoter score (US-MSG-08)', () => {
  it('sorts answers into detractors (0–6), passives (7–8) and promoters (9–10)', () => {
    expect(summariseNps([0, 6, 7, 8, 9, 10])).toEqual({
      answers: 6,
      promoters: 2,
      passives: 2,
      detractors: 2,
      score: 0,
    });
  });

  it('is the promoters’ share less the detractors’, in whole points', () => {
    // 3 promoters, 2 detractors of 7: 42.9% − 28.6% = 14.3 → 14.
    expect(summariseNps([10, 9, 9, 8, 7, 3, 0]).score).toBe(14);
  });

  it('runs from −100 to 100', () => {
    expect(summariseNps([9, 10, 10]).score).toBe(100);
    expect(summariseNps([0, 3, 6]).score).toBe(-100);
  });

  it('has no score when nobody answered — not 0', () => {
    // Nought is a real NPS: as many promoters as detractors. "Nobody was
    // asked" is a different fact and must not read as that one.
    expect(summariseNps([])).toEqual({
      answers: 0,
      promoters: 0,
      passives: 0,
      detractors: 0,
      score: null,
    });
  });

  it('scores a balanced room as a real 0', () => {
    expect(summariseNps([10, 0]).score).toBe(0);
  });

  it('rounds a half away from zero, the same both ways', () => {
    // Math.round(-12.5) is −12 while Math.round(12.5) is 13; a room one
    // detractor worse than even would read better than its mirror image.
    const onePromoter = [10, 7, 7, 7, 7, 7, 7, 7];
    const oneDetractor = [0, 7, 7, 7, 7, 7, 7, 7];
    expect(summariseNps(onePromoter).score).toBe(13);
    expect(summariseNps(oneDetractor).score).toBe(-13);
  });

  it('never reports −0', () => {
    // One detractor in 400 is −0.25, which rounds to −0: toBe(0) tells them
    // apart, and a "-0" on screen would be nonsense.
    const scores = [0, ...Array.from({ length: 399 }, () => 8)];
    expect(summariseNps(scores).score).toBe(0);
  });
});
