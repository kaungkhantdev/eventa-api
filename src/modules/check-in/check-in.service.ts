import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { Clock } from '../../common/time/clock';
import type { AuthContext } from '../auth/auth.types';
import { admissionOutcome } from './admission-outcome';
import { isCheckInOpen } from './check-in-window';
import { CheckInRepository } from './check-in.repository';
import { fingerprintScanToken } from './scan-token-fingerprint';
import type {
  AdmissibleTicket,
  AttendanceCounts,
  AttendanceQuery,
  AttendanceRow,
  CheckInMethod,
  ScanContext,
  ScanOutcome,
  ScanResult,
} from './check-in.types';
import { CheckInEventPort } from './ports/check-in-event.port';

export interface ScanInput {
  qrToken: string;
  stationId?: string;
}

export interface ManualAdmitInput {
  ticketId: string;
  method?: CheckInMethod;
  stationId?: string;
}

const DOOR_SHUT =
  'Check-in is not open for this event yet — or has already closed.';
const NEVER_ADMITTED = 'That ticket has not been checked in.';

/** A ticket in one of these states is not entitled to entry. */
const DENIED_STATUSES = new Set(['void', 'refunded', 'transferred']);

/**
 * The door (US-REG-11/12/13): admitting one person per ticket, however the
 * code reached us.
 *
 * A scan is NOT a read-then-write. `admit` is a single INSERT ... ON CONFLICT
 * that reports whether it inserted, so two staff scanning the same code at the
 * same instant produce one admission and one "already checked in" carrying the
 * first arrival time. Deciding in application code first would leave exactly
 * the window this is built to close.
 *
 * A refused scan is a RESULT, not an error: the door has to distinguish an
 * unknown code from a ticket for the wrong event from a refunded one, and an
 * HTTP error would collapse all three into "no". Only conditions that stop the
 * station working at all — a shut door, an event from another workspace —
 * throw.
 *
 * Every one of those five outcomes also writes a `scan_attempts` row, so a
 * refusal leaves a trace instead of vanishing (0068). An admission's row is
 * written inside `admit`'s own transaction, atomically with the `check_ins`
 * row; a refusal touches nothing else, so it is its own statement.
 */
@Injectable()
export class CheckInService {
  constructor(
    private readonly repo: CheckInRepository,
    private readonly events: CheckInEventPort,
    private readonly clock: Clock,
  ) {}

  /** Read a QR token at the station (US-REG-12). */
  async scan(
    auth: AuthContext,
    eventId: string,
    input: ScanInput,
  ): Promise<ScanResult> {
    await this.requireOpenDoor(auth, eventId);
    const ticket = await this.repo.findTicketByToken(
      auth.organizationId,
      input.qrToken,
    );
    return this.admit(auth, eventId, ticket, {
      method: 'qr',
      stationId: input.stationId ?? null,
      // The ledger gets the digest and never the token itself; the reasoning
      // is in `scan-token-fingerprint.ts`.
      tokenFingerprint: fingerprintScanToken(input.qrToken),
    });
  }

  /** Admit someone found by hand when the QR will not scan (US-REG-13). */
  async admitManually(
    auth: AuthContext,
    eventId: string,
    input: ManualAdmitInput,
  ): Promise<ScanResult> {
    await this.requireOpenDoor(auth, eventId);
    const ticket = await this.repo.findTicketById(
      auth.organizationId,
      input.ticketId,
    );
    return this.admit(auth, eventId, ticket, {
      method: input.method ?? 'manual',
      stationId: input.stationId ?? null,
      // Null, and that is the record: this route is reached by ticket id, so
      // no code was presented. An `upload` is decoded in the client, which
      // then looks the ticket up — the token never crosses the wire here.
      tokenFingerprint: null,
    });
  }

  /** Reverse an admission made in error (US-REG-11). */
  async undo(
    auth: AuthContext,
    eventId: string,
    ticketId: string,
  ): Promise<void> {
    await this.requireOpenDoor(auth, eventId);
    const undone = await this.repo.undo(
      auth.organizationId,
      eventId,
      ticketId,
      { undoneBy: auth.userId, now: this.clock.now() },
    );
    if (!undone) throw DomainException.notFound(NEVER_ADMITTED);
  }

  /**
   * The roll: who is expected, and who is already inside (US-REG-11).
   *
   * Deliberately NOT behind `requireOpenDoor`. Reading who is due is not
   * working the door: an organizer checks the list before the doors open and
   * reconciles it after they close, and refusing both because the window is
   * shut would make the screen useless exactly when it is wanted. Resolving the
   * event still gates on the workspace, so another org's roll simply 404s.
   */
  async listAttendance(
    auth: AuthContext,
    eventId: string,
    query: Omit<AttendanceQuery, 'eventId'>,
  ): Promise<{
    rows: AttendanceRow[];
    total: number;
    counts: AttendanceCounts;
  }> {
    await this.requireEvent(auth, eventId);
    const [page, counts] = await Promise.all([
      this.repo.listAttendance(auth.organizationId, { ...query, eventId }),
      this.repo.countAttendance(auth.organizationId, eventId),
    ]);
    return { ...page, counts };
  }

  /** The five outcomes of US-REG-12, decided in the order the door needs. */
  private async admit(
    auth: AuthContext,
    eventId: string,
    ticket: AdmissibleTicket | null,
    scan: ScanContext,
  ): Promise<ScanResult> {
    if (!ticket) return this.refuse(auth, eventId, scan, 'invalid', null);
    if (ticket.eventId !== eventId) {
      return this.refuse(auth, eventId, scan, 'wrong_event', ticket);
    }
    if (DENIED_STATUSES.has(ticket.status)) {
      return this.refuse(auth, eventId, scan, 'cancelled', ticket);
    }
    const { checkedInAt, inserted } = await this.repo.admit({
      organizationId: auth.organizationId,
      eventId,
      ticketId: ticket.id,
      attendeeId: ticket.attendeeId,
      checkedInBy: auth.userId,
      now: this.clock.now(),
      ...scan,
    });
    return {
      // `admit` wrote the ledger row from this same value, inside its own
      // transaction, so the station and the ledger cannot disagree.
      outcome: admissionOutcome(inserted),
      ticketId: ticket.id,
      holderName: ticket.holderName,
      ticketLabel: ticket.ticketLabel,
      checkedInAt,
    };
  }

  /**
   * Turn somebody away, and record that it happened (0068).
   *
   * The ledger write is awaited and NOT swallowed. A refusal that fails to log
   * would be invisible, and a scan ledger with holes in it is worse than none
   * because the holes read as a quiet night — which is the very thing the
   * ledger exists to distinguish from a broken scanner. If the ledger cannot
   * be written the station should hear about it.
   */
  private async refuse(
    auth: AuthContext,
    eventId: string,
    scan: ScanContext,
    outcome: ScanOutcome,
    ticket: AdmissibleTicket | null,
  ): Promise<ScanResult> {
    await this.repo.recordScanAttempt({
      organizationId: auth.organizationId,
      eventId,
      outcome,
      ticketId: ticket?.id ?? null,
      ticketEventId: otherEventId(eventId, ticket),
      scannedBy: auth.userId,
      scannedAt: this.clock.now(),
      ...scan,
    });
    return refused(outcome, ticket);
  }

  private async requireOpenDoor(
    auth: AuthContext,
    eventId: string,
  ): Promise<void> {
    const event = await this.requireEvent(auth, eventId);
    if (!isCheckInOpen(event, this.clock.now())) {
      throw DomainException.conflict(DOOR_SHUT);
    }
  }

  /**
   * Resolve the event, which IS the tenancy check — one from another workspace
   * does not come back, so it 404s rather than leaking that it exists.
   */
  private async requireEvent(auth: AuthContext, eventId: string) {
    const event = await this.events.findForCheckIn(
      auth.organizationId,
      eventId,
    );
    if (!event) throw DomainException.notFound('Event not found.');
    return event;
  }
}

function refused(
  outcome: ScanResult['outcome'],
  ticket: AdmissibleTicket | null,
): ScanResult {
  return {
    outcome,
    ticketId: ticket?.id ?? null,
    holderName: ticket?.holderName ?? null,
    ticketLabel: ticket?.ticketLabel ?? null,
    checkedInAt: null,
  };
}

/**
 * Which event a refused pass actually belonged to — recorded ONLY when it is
 * not this station's.
 *
 * That is the entire question `wrong_event` asks, and erd.md proposed it as
 * `check_ins.other_event_id`, where `UNIQUE(ticket_id)` left no room for it.
 * Null everywhere else so `ticket_event_id IS NOT NULL` reads as "a pass for
 * somewhere else turned up here", which it could not if a cancelled ticket's
 * row filled the column in with the event we already know.
 */
function otherEventId(
  eventId: string,
  ticket: AdmissibleTicket | null,
): string | null {
  const ticketEventId = ticket?.eventId ?? null;
  return ticketEventId === eventId ? null : ticketEventId;
}
