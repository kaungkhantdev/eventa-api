import { Injectable } from '@nestjs/common';
import { MAX_SEATS_PER_BOOKING } from '../../common/booking/booking.limits';
import { DomainException } from '../../common/errors/domain.exception';
import { Clock } from '../../common/time/clock';
import { pickDefined } from '../../common/util/pick-defined';
import type { EventActor } from '../events/events.types';
import { EventsService } from '../events/events.service';
import { TicketResponseDto } from './dto/ticket-response.dto';
import { CheckoutActivityPort } from './ports/checkout-activity.port';
import { toTicketResponse } from './ticketing.mapper';
import { TicketingPolicy } from './ticketing.policy';
import { TicketingRepository } from './ticketing.repository';
import type {
  CreateTicketInput,
  NewTicketValues,
  TicketRow,
  DeleteTicketResult,
  TicketStatus,
  UpdateTicketInput,
} from './ticketing.types';

const UPDATABLE_KEYS: (keyof NewTicketValues & keyof UpdateTicketInput)[] = [
  'name',
  'isFree',
  'priceSatang',
  'total',
  'admissionType',
  'minPerOrder',
  'maxPerOrder',
  'salesStartAt',
  'salesEndAt',
];

/** Manage an event's sellable ticket tiers (the Ticketing bounded context). */
@Injectable()
export class TicketingService {
  constructor(
    private readonly repo: TicketingRepository,
    private readonly events: EventsService,
    private readonly policy: TicketingPolicy,
    private readonly clock: Clock,
    private readonly checkout: CheckoutActivityPort,
  ) {}

  async createTicket(
    actor: EventActor,
    eventId: string,
    input: CreateTicketInput,
  ): Promise<TicketResponseDto> {
    await this.events.getEvent(actor, eventId); // 404 if not in the caller's org
    const name = input.name.trim();
    await this.assertNameFree(actor.organizationId, eventId, name);

    const isFree = input.isFree ?? false;
    const priceSatang = isFree ? 0 : (input.priceSatang ?? 0);
    const total = input.total ?? 0;
    const minPerOrder = input.minPerOrder ?? 1;
    const maxPerOrder = input.maxPerOrder ?? MAX_SEATS_PER_BOOKING;
    const salesStartAt = input.salesStartAt ?? null;
    const salesEndAt = input.salesEndAt ?? null;

    this.policy.assertWholeBaht(priceSatang);
    this.policy.assertSalesWindow(salesStartAt, salesEndAt);
    this.policy.assertPerOrderBounds(minPerOrder, maxPerOrder, total);

    const values: NewTicketValues = {
      organizationId: actor.organizationId,
      eventId,
      name,
      isFree,
      priceSatang,
      total,
      admissionType: input.admissionType ?? 'general_admission',
      // Availability is derived, never taken from the client (US-TKT-01).
      status: this.policy.resolveStatus(
        { status: 'scheduled', sold: 0, total, salesStartAt, salesEndAt },
        this.clock.now(),
      ),
      minPerOrder,
      maxPerOrder,
      salesStartAt,
      salesEndAt,
    };
    return this.respond(actor.organizationId, await this.repo.insert(values));
  }

  async listTickets(
    actor: EventActor,
    eventId: string,
  ): Promise<TicketResponseDto[]> {
    await this.events.getEvent(actor, eventId);
    const rows = await this.repo.listByEvent(actor.organizationId, eventId);
    const rate = await this.repo.orgVatRate(actor.organizationId);
    return rows.map((r) => toTicketResponse(r, rate));
  }

  async updateTicket(
    actor: EventActor,
    eventId: string,
    ticketId: string,
    input: UpdateTicketInput,
  ): Promise<TicketResponseDto> {
    const ticket = await this.load(actor.organizationId, eventId, ticketId);
    if (input.version !== undefined && input.version !== ticket.version) {
      throw this.stale();
    }
    this.policy.assertChangeAllowedAfterSales(ticket, input);
    await this.assertRenameAllowed(
      actor.organizationId,
      eventId,
      ticketId,
      input,
    );

    const merged = this.merge(ticket, input);
    this.policy.assertQuantityNotBelowSold(merged.total, ticket.sold);
    this.policy.assertWholeBaht(merged.priceSatang);
    this.policy.assertSalesWindow(merged.salesStartAt, merged.salesEndAt);
    this.policy.assertPerOrderBounds(
      merged.minPerOrder,
      merged.maxPerOrder,
      merged.total,
    );

    const updated = await this.repo.update(
      actor.organizationId,
      ticketId,
      {
        ...this.buildValues(input),
        // Re-derive availability from the values as they will be (US-TKT-02/03).
        status: this.policy.resolveStatus(merged, this.clock.now()),
      },
      ticket.version,
    );
    if (!updated) throw this.stale();
    return this.respond(actor.organizationId, updated);
  }

  /** Pause selling on demand — it stops even inside its sales window (US-TKT-03). */
  async pauseTicket(
    actor: EventActor,
    eventId: string,
    ticketId: string,
  ): Promise<TicketResponseDto> {
    const ticket = await this.load(actor.organizationId, eventId, ticketId);
    return this.setStatus(actor.organizationId, ticket, 'paused');
  }

  /**
   * Resume selling. A tier whose window has already closed cannot come back
   * without a new end date — resuming it would promise a sale we must refuse.
   */
  async resumeTicket(
    actor: EventActor,
    eventId: string,
    ticketId: string,
  ): Promise<TicketResponseDto> {
    const ticket = await this.load(actor.organizationId, eventId, ticketId);
    const now = this.clock.now();
    if (ticket.salesEndAt && ticket.salesEndAt.getTime() < now.getTime()) {
      throw DomainException.conflict(
        'Sales for this ticket type have already ended — extend the sales end date first.',
      );
    }
    // Resolve from a non-paused baseline so it lands on sale, scheduled or sold out.
    const status = this.policy.resolveStatus(
      { ...ticket, status: 'onsale' },
      now,
    );
    return this.setStatus(actor.organizationId, ticket, status);
  }

  private async setStatus(
    organizationId: number,
    ticket: TicketRow,
    status: TicketStatus,
  ): Promise<TicketResponseDto> {
    const updated = await this.repo.update(
      organizationId,
      ticket.id,
      { status },
      ticket.version,
    );
    if (!updated) throw this.stale();
    return this.respond(organizationId, updated);
  }

  /** The tier as it will be once `input` is applied — what the rules judge. */
  private merge(ticket: TicketRow, input: UpdateTicketInput) {
    return {
      status: ticket.status,
      sold: ticket.sold,
      total: input.total ?? ticket.total,
      priceSatang: input.isFree ? 0 : (input.priceSatang ?? ticket.priceSatang),
      minPerOrder: input.minPerOrder ?? ticket.minPerOrder,
      maxPerOrder: input.maxPerOrder ?? ticket.maxPerOrder,
      salesStartAt:
        input.salesStartAt !== undefined
          ? input.salesStartAt
          : ticket.salesStartAt,
      salesEndAt:
        input.salesEndAt !== undefined ? input.salesEndAt : ticket.salesEndAt,
    };
  }

  private async assertRenameAllowed(
    organizationId: number,
    eventId: string,
    ticketId: string,
    input: UpdateTicketInput,
  ): Promise<void> {
    if (input.name === undefined) return;
    await this.assertNameFree(
      organizationId,
      eventId,
      input.name.trim(),
      ticketId,
    );
  }

  /**
   * Remove a tier created by mistake, or retire one that has already sold
   * (US-TKT-05). A tier that never sold is erased; one with sales is soft-deleted
   * so it leaves the active list and stops selling while every issued ticket
   * still resolves to it. Nothing is refunded or cancelled here — those are
   * finance actions, taken deliberately and separately.
   */
  async deleteTicket(
    actor: EventActor,
    eventId: string,
    ticketId: string,
  ): Promise<DeleteTicketResult> {
    const ticket = await this.load(actor.organizationId, eventId, ticketId);
    const remaining = await this.repo.countActive(
      actor.organizationId,
      eventId,
    );
    if (remaining <= 1) {
      throw DomainException.validation(
        'An event must keep at least one ticket type — this is the last one.',
      );
    }
    if (await this.checkout.hasActiveHolds(actor.organizationId, ticketId)) {
      throw DomainException.conflict(
        'Someone is checking out with this ticket type — pause it and try again shortly.',
      );
    }
    if (ticket.sold === 0) {
      await this.repo.hardDelete(actor.organizationId, ticketId);
      return { outcome: 'removed' };
    }
    await this.repo.softDelete(actor.organizationId, ticketId);
    return { outcome: 'retired' };
  }

  /** Copy the source event's tiers onto a new event: 0 sold, sales window cleared. */
  async cloneForEvent(
    actor: EventActor,
    srcEventId: string,
    destEventId: string,
  ): Promise<void> {
    const rows = await this.repo.listByEvent(actor.organizationId, srcEventId);
    for (const t of rows) {
      const values: NewTicketValues = {
        organizationId: actor.organizationId,
        eventId: destEventId,
        name: t.name,
        isFree: t.isFree,
        priceSatang: t.priceSatang,
        currency: t.currency,
        status: t.status,
        admissionType: t.admissionType,
        total: t.total,
        salesStartAt: null,
        salesEndAt: null,
        minPerOrder: t.minPerOrder,
        maxPerOrder: t.maxPerOrder,
        iconClass: t.iconClass,
      };
      await this.repo.insert(values);
    }
  }

  private buildValues(input: UpdateTicketInput): Partial<NewTicketValues> {
    const values = pickDefined(input, UPDATABLE_KEYS);
    if (values.name !== undefined) values.name = values.name.trim();
    if (values.isFree === true) values.priceSatang = 0;
    return values;
  }

  private async assertNameFree(
    organizationId: number,
    eventId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    if (await this.repo.nameExists(organizationId, eventId, name, excludeId)) {
      throw DomainException.conflict(
        'A ticket type with this name already exists for this event.',
      );
    }
  }

  private async load(
    organizationId: number,
    eventId: string,
    ticketId: string,
  ): Promise<TicketRow> {
    const ticket = await this.repo.findTicket(
      organizationId,
      eventId,
      ticketId,
    );
    if (!ticket) {
      throw DomainException.notFound(
        `Ticket type ${ticketId} not found for this event.`,
      );
    }
    return ticket;
  }

  private async respond(
    organizationId: number,
    row: TicketRow,
  ): Promise<TicketResponseDto> {
    const rate = await this.repo.orgVatRate(organizationId);
    return toTicketResponse(row, rate);
  }

  private stale(): DomainException {
    return DomainException.conflict(
      'This ticket type changed elsewhere. Reload and try again.',
    );
  }
}
