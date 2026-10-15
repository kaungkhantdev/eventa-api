import type { localeEnum } from '../../db/schema';

/** The two languages Eventa writes to people in — the `locale` enum's values. */
export type Locale = (typeof localeEnum.enumValues)[number];
