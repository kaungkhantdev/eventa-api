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
