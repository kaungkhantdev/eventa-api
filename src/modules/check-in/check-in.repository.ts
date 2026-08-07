import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { auditEvents, checkIns, tickets } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type {
  AdmissibleTicket,
  AdmitInput,
  AdmitOutcome,
} from './check-in.types';

const AUDIT_TYPE = 'checkin' as const;

export interface UndoInput {
  undoneBy: string;
  now: Date;
}

/**
 * Data access for the door. The interesting method is `admit`.
 */
@Injectable()
export class CheckInRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Admit one ticket, exactly once, in a SINGLE statement.
   *
   * `uq_check_ins_ticket` decides the race: two concurrent scans both attempt
   * the insert, the second blocks on the index until the first commits, then
   * takes the conflict path. `DO UPDATE` rather than `DO NOTHING` because a
   * conflicting `DO NOTHING` returns no row at all — the caller would have to
   * read again, which is the very window this exists to close. `LEAST` keeps
   * the EARLIEST arrival, so a replayed or out-of-order admission never
   * rewrites the time someone actually walked in. `xmax = 0` is Postgres's own
   * answer to "did I insert, or did I collide?".
   *
   * The `tickets` projection is updated in the same transaction so the
   * attendee's ticket view agrees with the ledger.
   */
  async admit(input: AdmitInput): Promise<AdmitOutcome> {
    return withTenant(this.db, input.organizationId, async (tx) => {
      const result = await tx.execute<{
        checked_in_at: string;
        inserted: boolean;
      }>(sql`
        INSERT INTO check_ins (organization_id, event_id, ticket_id, attendee_id,
                               checked_in_at, method, checked_in_by, station_id)
        VALUES (${input.organizationId}, ${input.eventId}, ${input.ticketId},
                ${input.attendeeId}, ${input.now}, ${input.method},
                ${input.checkedInBy}, ${input.stationId})
        ON CONFLICT ON CONSTRAINT uq_check_ins_ticket DO UPDATE
          SET checked_in_at = LEAST(check_ins.checked_in_at, EXCLUDED.checked_in_at)
        RETURNING checked_in_at, (xmax = 0) AS inserted
      `);
      const row = result.rows[0];
      // A raw `execute` hands back the timestamp as the driver sees it, not as
      // a Date — the projection update below needs a real one.
      const checkedInAt = new Date(row.checked_in_at);
      await tx
        .update(tickets)
        .set({ status: 'checked_in', checkedInAt })
        .where(
          and(
            eq(tickets.id, input.ticketId),
            eq(tickets.organizationId, input.organizationId),
          ),
        );
      return { checkedInAt, inserted: Boolean(row.inserted) };
    });
  }

  /**
   * Reverse an admission. Deletes the ledger row and puts the ticket back to
   * `issued`, together — a half-undone check-in would leave the roster and the
   * attendee's own view disagreeing. Returns false when there was nothing to
   * undo, so the caller can 404 rather than report a success it did not have.
   */
  async undo(
    organizationId: number,
    eventId: string,
    ticketId: string,
    input: UndoInput,
  ): Promise<boolean> {
    return withTenant(this.db, organizationId, async (tx) => {
      const deleted = await tx
        .delete(checkIns)
        .where(
          and(
            eq(checkIns.organizationId, organizationId),
            eq(checkIns.eventId, eventId),
            eq(checkIns.ticketId, ticketId),
          ),
        )
        .returning({ id: checkIns.id });
      if (deleted.length === 0) return false;
      await tx
        .update(tickets)
        .set({ status: 'issued', checkedInAt: null })
        .where(
          and(
            eq(tickets.id, ticketId),
            eq(tickets.organizationId, organizationId),
          ),
        );
      // The ledger row is gone, so the audit trail is the only remaining
      // evidence that this person was ever admitted.
      await tx.insert(auditEvents).values({
        organizationId,
        type: AUDIT_TYPE,
        title: `Undid check-in for ticket ${ticketId}`,
        actorUserId: input.undoneBy,
      });
      return true;
    });
  }

  /** The ticket behind a scanned QR token, if the token is one of ours. */
  async findTicketByToken(
    organizationId: number,
    qrToken: string,
  ): Promise<AdmissibleTicket | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select(this.ticketColumns())
        .from(tickets)
        .where(
          and(
            eq(tickets.organizationId, organizationId),
            eq(tickets.qrToken, qrToken),
          ),
        )
        .limit(1);
      return row ?? null;
    });
  }

  async findTicketById(
    organizationId: number,
    ticketId: string,
  ): Promise<AdmissibleTicket | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select(this.ticketColumns())
        .from(tickets)
        .where(
          and(
            eq(tickets.organizationId, organizationId),
            eq(tickets.id, ticketId),
          ),
        )
        .limit(1);
      return row ?? null;
    });
  }

  private ticketColumns() {
    return {
      id: tickets.id,
      eventId: tickets.eventId,
      attendeeId: tickets.attendeeId,
      holderName: tickets.holderName,
      ticketLabel: tickets.ticketLabel,
      status: tickets.status,
    };
  }
}
