import type { calendarConnections } from '../../db/schema';

/** The row as stored — never exposed at the edge; map it first. */
export type CalendarConnectionRow = typeof calendarConnections.$inferSelect;

/** Where the stored connection stands; no row reads as 'disconnected'. */
export type StoredConnectionStatus = CalendarConnectionRow['status'];

/** What the API reports, which adds "this server has no Google client". */
export type CalendarConnectionStatus =
  'not_configured' | StoredConnectionStatus;

/** The single pending connect, as taken (and consumed) at the callback. */
export type PendingState =
  | { kind: 'none' }
  | { kind: 'mismatch' }
  | {
      kind: 'match';
      userId: string;
      verifierCipher: Buffer;
      /** Still inside its ten minutes, judged by the database clock. */
      live: boolean;
    };
