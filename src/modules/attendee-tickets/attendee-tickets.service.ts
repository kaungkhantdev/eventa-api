import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { qrSvg } from '../../common/qr/qr';
import { daysLeft } from '../../common/time/bangkok';
import { Clock } from '../../common/time/clock';
import { UsersRepository } from '../users/users.repository';
import { AttendeeTicketsRepository } from './attendee-tickets.repository';
import type {
  IssuedTicketStatus,
  MyRegistrationRow,
  TicketPassRow,
} from './attendee-tickets.types';
import type {
  MyEventsDto,
  MyRegistrationDto,
  TicketPassDto,
} from './dto/my-events.dto';
import { renderPassSvg } from './ticket-pass.svg';

/** A ticket in these states still admits; anything else no longer does. */
const VALID_STATUSES: readonly IssuedTicketStatus[] = ['issued', 'checked_in'];
const TODAY = 'Today';
const TOMORROW = 'Tomorrow';

/**
 * The attendee's own tickets (US-DISC-07/09): the Upcoming/Past split of My
 * Events, one ticket's pass, and its printable download.
 *
 * Identity is the signed-in ACCOUNT's email, resolved server-side from the
 * token's user id — never from a parameter. That email is what checkout stamped
 * on the order, so a guest's purchases surface the moment they sign in with the
 * same address, and nothing a caller sends can widen whose tickets they see.
 */
@Injectable()
export class AttendeeTicketsService {
  constructor(
    private readonly repo: AttendeeTicketsRepository,
    private readonly users: UsersRepository,
    private readonly clock: Clock,
  ) {}

  async myEvents(userId: string): Promise<MyEventsDto> {
    const email = await this.requireEmail(userId);
    const rows = await this.repo.registrationsByEmail(email);
    const now = this.clock.now();
    const upcoming = rows
      .filter((row) => this.isUpcoming(row, now))
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
      .map((row) => this.toCard(row, now));
    const past = rows
      .filter((row) => !this.isUpcoming(row, now))
      .sort((a, b) => b.startAt.getTime() - a.startAt.getTime())
      .map((row) => this.toCard(row, null));
    return {
      upcoming,
      past,
      counts: { upcoming: upcoming.length, past: past.length },
    };
  }

  async ticket(userId: string, ticketId: string): Promise<TicketPassDto> {
    const row = await this.requireOwnTicket(userId, ticketId);
    return this.toPass(row);
  }

  /** The printable pass. Only a still-valid ticket may leave as one (US-DISC-07). */
  async passSvg(userId: string, ticketId: string): Promise<string> {
    const row = await this.requireOwnTicket(userId, ticketId);
    if (!this.isValid(row.status)) {
      throw DomainException.conflict(
        'This ticket is no longer valid and cannot be downloaded as a pass.',
      );
    }
    return renderPassSvg(this.toPass(row), await qrSvg(row.qrToken));
  }

  private async requireOwnTicket(
    userId: string,
    ticketId: string,
  ): Promise<TicketPassRow> {
    const email = await this.requireEmail(userId);
    // Ownership by resolution: a ticket that isn't yours simply isn't found.
    const row = await this.repo.ticketByIdForEmail(ticketId, email);
    if (!row) throw DomainException.notFound("This ticket isn't available.");
    return row;
  }

  private async requireEmail(userId: string): Promise<string> {
    const profile = await this.users.findProfile(userId);
    if (!profile) throw DomainException.notFound('Account not found.');
    return profile.user.email;
  }

  /** An event stays in Upcoming until it has actually ended, not just begun. */
  private isUpcoming(row: MyRegistrationRow, now: Date): boolean {
    return (row.endAt ?? row.startAt).getTime() >= now.getTime();
  }

  private toCard(row: MyRegistrationRow, now: Date | null): MyRegistrationDto {
    return {
      orderId: row.orderId,
      reference: row.reference,
      eventId: row.eventId,
      eventSlug: row.eventSlug,
      eventName: row.eventName,
      startAt: row.startAt.toISOString(),
      timezone: row.timezone,
      venueName: row.isOnline ? null : row.venueName,
      venueAddress: row.isOnline ? null : row.venueAddress,
      city: row.isOnline ? null : row.city,
      isOnline: row.isOnline,
      coverImage: row.coverImage,
      ticketTypeName: row.ticketTypeName,
      ticketCount: row.ticketCount,
      countdown: now ? countdown(now, row.startAt) : null,
      attended: row.attended,
    };
  }

  private toPass(row: TicketPassRow): TicketPassDto {
    const hasSeat = row.seatNumber !== null;
    return {
      id: row.id,
      reference: row.orderReference,
      qrToken: row.qrToken,
      status: row.status,
      valid: this.isValid(row.status),
      holderName: row.holderName,
      ticketLabel: row.ticketLabel,
      admissionNumber: admissionNumber(row),
      eventName: row.eventName,
      eventSlug: row.eventSlug,
      startAt: row.startAt.toISOString(),
      timezone: row.timezone,
      venueName: row.isOnline ? null : row.venueName,
      venueAddress: row.isOnline ? null : row.venueAddress,
      city: row.isOnline ? null : row.city,
      isOnline: row.isOnline,
      seat: hasSeat
        ? { section: row.seatSection, row: row.seatRow, number: row.seatNumber }
        : null,
    };
  }

  private isValid(status: IssuedTicketStatus): boolean {
    return VALID_STATUSES.includes(status);
  }
}

/** "6 days left" / "Tomorrow" / "Today" — whole Bangkok calendar days. */
function countdown(now: Date, startAt: Date): string {
  const days = daysLeft(now, startAt);
  if (days === 0) return TODAY;
  if (days === 1) return TOMORROW;
  return `${days} days left`;
}

/** This ticket's place among its order's admissions: "2 of 3". */
function admissionNumber(row: TicketPassRow): string {
  const index = row.siblingTicketIds.indexOf(row.id);
  return `${index + 1} of ${row.siblingTicketIds.length}`;
}
