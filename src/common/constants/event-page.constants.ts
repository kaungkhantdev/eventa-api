import { templateIdEnum } from '../../db/schema/index';

/** The event-page module's named constants. */

export const TEMPLATES = templateIdEnum.enumValues;

/** Used when no accent is set, or the one given is unusable (US-PAGE-10). */
export const DEFAULT_ACCENT = '#2563EB';

export const ACCENT_PATTERN = /^#[0-9a-f]{6}$/i;

export const DEFAULT_TEMPLATE = 'aurora';

export const DEFAULT_AGENDA_TITLE = 'Agenda';

export const DEFAULT_SPEAKERS_TITLE = 'Speakers';

/** A preview with no date still needs one to render; an hour is a sane default. */
export const PREVIEW_DEFAULT_DURATION_MS = 60 * 60 * 1000;
