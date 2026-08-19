/** How long an identical invite is suppressed rather than re-sent. */
export const INVITE_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

export const MAX_MESSAGE_LENGTH = 250;

export interface SendInviteInput {
  eventId: string;
  recipientName: string;
  recipientEmail: string;
  message?: string;
}

/** What sending turned out to mean. */
export interface InviteOutcome {
  /** False when an identical invite was already sent inside the window. */
  sent: boolean;
  recipientEmail: string;
  sentAt: Date;
}
