import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { withTenant, type Tx } from '../../db/tenant';
import { OutboxPort, type OutboxEventInput } from '../platform/outbox.port';

export interface RecordInviteInput {
  organizationId: number;
  eventId: string;
  recipientName: string;
  recipientEmail: string;
  message: string | null;
  invitedBy: string;
  now: Date;
  /** Anything sent before this is stale enough to send again. */
  resendCutoff: Date;
}

export interface RecordedInvite {
  sent: boolean;
  sentAt: Date;
}

/**
 * Data access for invitations. The dedupe is the whole method.
 */
@Injectable()
export class InvitationsRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: OutboxPort,
  ) {}

  /**
   * Record the invite and, only if it is genuinely new or stale enough to
   * repeat, enqueue the email — in ONE transaction, so an invite can never be
   * recorded without its mail or mailed without its record.
   *
   * The suppression is a single statement: the unique constraint catches a
   * repeat, and the `WHERE` on the conflict action refuses to touch anything
   * sent inside the window. No row comes back in that case, which IS the
   * answer — a read-then-write would let two rapid submissions both decide
   * they were first.
   */
  async record(
    input: RecordInviteInput,
    event: (sentAt: Date) => OutboxEventInput,
  ): Promise<RecordedInvite | null> {
    return withTenant(this.db, input.organizationId, async (tx: Tx) => {
      const result = await tx.execute<{ sent_at: string }>(sql`
        INSERT INTO event_invitations (organization_id, event_id, recipient_name,
                                       recipient_email, message, invited_by, sent_at)
        VALUES (${input.organizationId}, ${input.eventId}, ${input.recipientName},
                ${input.recipientEmail}, ${input.message}, ${input.invitedBy},
                ${input.now})
        ON CONFLICT ON CONSTRAINT uq_event_invitations_recipient DO UPDATE
          SET sent_at = EXCLUDED.sent_at,
              recipient_name = EXCLUDED.recipient_name,
              message = EXCLUDED.message
          WHERE event_invitations.sent_at < ${input.resendCutoff}
        RETURNING sent_at
      `);
      const row = result.rows[0];
      if (!row) return null;
      const sentAt = new Date(row.sent_at);
      await this.outbox.enqueueIn(tx, event(sentAt));
      return { sent: true, sentAt };
    });
  }
}
