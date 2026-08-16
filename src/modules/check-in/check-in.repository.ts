import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { auditEvents, checkIns, ticketTypes, tickets } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type {
  AdmissibleTicket,
  AdmitInput,
  AdmitOutcome,
  AttendanceCounts,
  AttendanceQuery,
  AttendanceRow,
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
  /**
   * The roll: everyone holding a ticket that entitles entry, and whether they
   * are already inside (US-REG-11).
   *
   * A LEFT JOIN, not a filter: somebody still expected has no `check_ins` row,
   * and an inner join would answer "who came" to a question about who is due.
   * Statuses that deny entry are excluded here rather than in the service —
   * a refunded ticket is not somebody the door is waiting for.
   */
  async listAttendance(
    organizationId: number,
    query: AttendanceQuery,
  ): Promise<{ rows: AttendanceRow[]; total: number }> {
    return withTenant(this.db, organizationId, async (tx) => {
      const where = this.attendanceWhere(organizationId, query);
      const offset = (query.page - 1) * query.limit;

      const rows = await tx
        .select({
          ticketId: tickets.id,
          holderName: tickets.holderName,
          ticketLabel: tickets.ticketLabel,
          ticketTypeName: ticketTypes.name,
          checkedInAt: checkIns.checkedInAt,
          method: checkIns.method,
        })
        .from(tickets)
        .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
        .leftJoin(checkIns, eq(checkIns.ticketId, tickets.id))
        .where(where)
        .orderBy(...this.attendanceOrder(query.sort))
        .limit(query.limit)
        .offset(offset);

      const [counted] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(tickets)
        .leftJoin(checkIns, eq(checkIns.ticketId, tickets.id))
        .where(where);

      return {
        rows: rows.map((row) => ({
          ...row,
          status: row.checkedInAt
            ? ('checked_in' as const)
            : ('expected' as const),
        })),
        total: counted?.total ?? 0,
      };
    });
  }

  /**
   * The headline figures, counted across the whole event rather than the page
   * on screen — the station shows them while looking at eight of a thousand.
   */
  async countAttendance(
    organizationId: number,
    eventId: string,
  ): Promise<AttendanceCounts> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({
          total: sql<number>`count(*)::int`,
          checkedIn: sql<number>`count(${checkIns.id})::int`,
        })
        .from(tickets)
        .leftJoin(checkIns, eq(checkIns.ticketId, tickets.id))
        .where(this.admissible(organizationId, eventId));

      const total = row?.total ?? 0;
      const checkedIn = row?.checkedIn ?? 0;
      return { total, checkedIn, expected: total - checkedIn };
    });
  }

  /** Tickets for this event that entitle entry at all. */
  private admissible(organizationId: number, eventId: string) {
    return and(
      eq(tickets.organizationId, organizationId),
      eq(tickets.eventId, eventId),
      isNull(tickets.deletedAt),
      sql`${tickets.status} NOT IN ('void', 'refunded', 'transferred')`,
    );
  }

  private attendanceWhere(organizationId: number, query: AttendanceQuery) {
    const clauses = [this.admissible(organizationId, query.eventId)];
    if (query.status === 'checked_in') clauses.push(isNotNull(checkIns.id));
    if (query.status === 'expected') clauses.push(isNull(checkIns.id));
    if (query.search) {
      const term = `%${query.search}%`;
      clauses.push(
        or(ilike(tickets.holderName, term), ilike(tickets.ticketLabel, term)),
      );
    }
    return and(...clauses);
  }

  /**
   * Newest arrival first for the feed; by name otherwise. The ticket id breaks
   * ties so paging is stable — without it two rows sharing a name can swap
   * between pages and one is read twice while another is never seen.
   */
  private attendanceOrder(sort: AttendanceQuery['sort']) {
    return sort === 'recent'
      ? [desc(checkIns.checkedInAt), asc(tickets.id)]
      : [asc(tickets.holderName), asc(tickets.id)];
  }

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
