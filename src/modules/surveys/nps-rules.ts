/** The scale a recommendation question is answered on. */
export const MIN_NPS_SCORE = 0;
export const MAX_NPS_SCORE = 10;

/** The standard NPS bands: 9–10 promote, 7–8 are passive, 0–6 detract. */
const PROMOTER_FROM = 9;
const DETRACTOR_UP_TO = 6;
const PERCENT = 100;

export interface NpsSummary {
  answers: number;
  promoters: number;
  passives: number;
  detractors: number;
  /**
   * Whole points from −100 to 100. Null when nobody answered — never 0, which
   * is a real score: as many promoters as detractors.
   */
  score: number | null;
}

/**
 * The net promoter score of a set of 0–10 answers (US-MSG-08): the share of
 * promoters less the share of detractors.
 *
 * Each ANSWER counts once, so a figure pooled across events is weighted by how
 * many answered each — an event three people answered cannot swing it as far
 * as one three hundred did.
 */
export function summariseNps(scores: readonly number[]): NpsSummary {
  const promoters = scores.filter((s) => s >= PROMOTER_FROM).length;
  const detractors = scores.filter((s) => s <= DETRACTOR_UP_TO).length;
  const answers = scores.length;
  return {
    answers,
    promoters,
    passives: answers - promoters - detractors,
    detractors,
    score:
      answers === 0
        ? null
        : wholePoints((PERCENT * (promoters - detractors)) / answers),
  };
}

/**
 * Halves away from zero, so a room one detractor worse than even reads as the
 * mirror of one a promoter better — Math.round(−12.5) is −12 but
 * Math.round(12.5) is 13. `+ 0` turns the −0 that rounds out of −0.25 into 0.
 */
function wholePoints(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value)) + 0;
}
