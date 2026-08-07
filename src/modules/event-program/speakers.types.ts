import type { speakers } from '../../db/schema';

/** A selected `speakers` row. */
export type SpeakerRow = typeof speakers.$inferSelect;
/** A `speakers` insert shape. */
export type NewSpeakerValues = typeof speakers.$inferInsert;
/** Avatar tone (`speaker_tone` enum). */
export type SpeakerTone = SpeakerRow['tone'];

/** Service input to add a speaker to an event. */
export interface CreateSpeakerInput {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  talkTitle?: string;
  tag?: string;
  initials?: string;
  tone?: SpeakerTone;
  bio?: string;
  photoUrl?: string;
  website?: string;
  socialLinks?: Record<string, string>;
}

/** Service input to edit a speaker (undefined = leave as-is). */
export interface UpdateSpeakerInput {
  name?: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  talkTitle?: string | null;
  tag?: string | null;
  initials?: string | null;
  tone?: SpeakerTone;
  bio?: string | null;
  photoUrl?: string | null;
  website?: string | null;
  socialLinks?: Record<string, string> | null;
  /** Optimistic-concurrency token; when set, must match the current row. */
  version?: number;
}

/** How the speaker directory is narrowed (US-PROG-08). */
export interface SpeakerFilters {
  page: number;
  limit: number;
  /** Matches name, role or email. */
  search?: string;
}
