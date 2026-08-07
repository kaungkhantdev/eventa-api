import type { sessions } from '../../db/schema';

/** A selected `sessions` row. */
export type SessionRow = typeof sessions.$inferSelect;
/** A `sessions` insert shape. */
export type NewSessionValues = typeof sessions.$inferInsert;
/** `session_type` enum (Keynote/Talk/Workshop/Panel/Break). */
export type SessionType = SessionRow['type'];
/** `session_color` enum, nullable. */
export type SessionColor = SessionRow['color'];

/** A speaker reference on a session (id + display name). */
export interface SessionSpeakerRef {
  id: string;
  name: string;
}

/** Service input to add an agenda session. */
export interface CreateSessionInput {
  day: number;
  startTime: string;
  endTime?: string;
  title: string;
  type: SessionType;
  room?: string;
  description?: string;
  sortOrder?: number;
  speakerIds?: string[];
  /** Re-submit with this after a speaker-clash refusal to assign them anyway. */
  confirmSpeakerClash?: boolean;
}

/** Service input to edit a session (undefined = leave as-is). */
export interface UpdateSessionInput {
  day?: number;
  startTime?: string;
  endTime?: string | null;
  title?: string;
  type?: SessionType;
  room?: string | null;
  description?: string | null;
  sortOrder?: number;
  speakerIds?: string[];
  /** Re-submit with this after a speaker-clash refusal to assign them anyway. */
  confirmSpeakerClash?: boolean;
  /** Optimistic-concurrency token; when set, must match the current row. */
  version?: number;
}

/** A session a speaker is already booked into, for the US-PROG-05 clash check. */
export interface SpeakerClashCandidate {
  sessionId: string;
  title: string;
  startTime: string;
  endTime: string | null;
  speakerName: string;
}
