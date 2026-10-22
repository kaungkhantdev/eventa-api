/** The surveys module's named constants. */

/** The scale a recommendation question is answered on. */
export const MIN_NPS_SCORE = 0;

export const MAX_NPS_SCORE = 10;

/** The standard NPS bands: 9–10 promote, 7–8 are passive, 0–6 detract. */
export const PROMOTER_FROM = 9;

export const DETRACTOR_UP_TO = 6;

export const PERCENT = 100;

/** The scale a rating question is answered on. */
export const MIN_RATING = 1;

export const MAX_RATING = 5;

/** One decimal place: the difference between 4.27 and 4.3 is noise. */
export const PRECISION = 10;

export const CONFIRMED = 'confirmed';

/** A delivery the transport accepted. A 'failed' one asked nobody anything. */
export const SENT = 'sent';

/** A personal list, not an export — one event's feedback is bounded. */
export const MAX_RESPONSES = 500;

/** A choice between one thing is not a choice. */
export const MIN_OPTIONS = 2;

/**
 * One recommendation question per survey: a second would count each person
 * twice in that survey's NPS.
 */
export const MAX_NPS_QUESTIONS = 1;

/** Marks a duplicate as the fresh draft it is, rather than a second original. */
export const COPY_SUFFIX = ' (copy)';
