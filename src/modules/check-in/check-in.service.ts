import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { Clock } from '../../common/time/clock';
import type { AuthContext } from '../auth/auth.types';
import { isCheckInOpen } from './check-in-window';
import { CheckInRepository } from './check-in.repository';
import type {
  AdmissibleTicket,
  CheckInMethod,
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
    return this.admit(auth, eventId, ticket, 'qr', input.stationId ?? null);
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
    return this.admit(
      auth,
      eventId,
      ticket,
      input.method ?? 'manual',
      input.stationId ?? null,
    );
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

  /** The five outcomes of US-REG-12, decided in the order the door needs. */
  private async admit(
    auth: AuthContext,
    eventId: string,
    ticket: AdmissibleTicket | null,
    method: CheckInMethod,
    stationId: string | null,
  ): Promise<ScanResult> {
    if (!ticket) return refused('invalid');
    if (ticket.eventId !== eventId) return refused('wrong_event', ticket);
    if (DENIED_STATUSES.has(ticket.status)) {
      return refused('cancelled', ticket);
    }
    const { checkedInAt, inserted } = await this.repo.admit({
      organizationId: auth.organizationId,
      eventId,
      ticketId: ticket.id,
      attendeeId: ticket.attendeeId,
      method,
      checkedInBy: auth.userId,
      stationId,
      now: this.clock.now(),
    });
    return {
      outcome: inserted ? 'admitted' : 'already_checked_in',
      ticketId: ticket.id,
      holderName: ticket.holderName,
      ticketLabel: ticket.ticketLabel,
      checkedInAt,
    };
  }

  private async requireOpenDoor(
    auth: AuthContext,
    eventId: string,
  ): Promise<void> {
    const event = await this.events.findForCheckIn(
      auth.organizationId,
      eventId,
    );
    if (!event) throw DomainException.notFound('Event not found.');
    if (!isCheckInOpen(event, this.clock.now())) {
      throw DomainException.conflict(DOOR_SHUT);
    }
  }
}

function refused(
  outcome: ScanResult['outcome'],
  ticket?: AdmissibleTicket,
): ScanResult {
  return {
    outcome,
    ticketId: ticket?.id ?? null,
    holderName: ticket?.holderName ?? null,
    ticketLabel: ticket?.ticketLabel ?? null,
    checkedInAt: null,
  };
}
