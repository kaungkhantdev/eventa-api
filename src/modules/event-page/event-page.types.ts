import type { PublicPage } from '../public-pages/public-pages.types';

/** The page settings an organizer controls (US-PAGE-10). */
export interface UpdatePageInput {
  template?: string;
  slug?: string;
  accentColor?: string;
  agendaTitle?: string | null;
  speakersTitle?: string | null;
}

export interface PageSettings {
  slug: string;
  template: string;
  accentColor: string;
  published: boolean;
}

/** The unsaved values a preview renders (US-PAGE-09). Nothing is persisted. */
export interface PreviewInput {
  name?: string;
  description?: string | null;
  type?: string;
  startAt?: string;
  endAt?: string | null;
  isOnline?: boolean;
  onlineNote?: string | null;
  venueName?: string | null;
  venueAddress?: string | null;
  city?: string | null;
  coverImage?: string | null;
  accentColor?: string;
  organizerName?: string;
  template?: string;
  highlights?: string[];
  agendaTitle?: string | null;
  speakersTitle?: string | null;
}

/** A preview is the same shape as a live page, flagged so nothing counts it. */
export interface PreviewPage extends PublicPage {
  isPreview: true;
}
