import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { pickDefined } from '../../common/util/pick-defined';
import type { EventActor } from '../events/events.types';
import { EventsService } from '../events/events.service';
import { TicketResponseDto } from './dto/ticket-response.dto';
import { toTicketResponse } from './ticketing.mapper';
import { TicketingRepository } from './ticketing.repository';
import type {
  CreateTicketInput,
  NewTicketValues,
  TicketRow,
  UpdateTicketInput,
} from './ticketing.types';

const UPDATABLE_KEYS: (keyof NewTicketValues & keyof UpdateTicketInput)[] = [
  'name',
  'isFree',
  'priceSatang',
  'total',
  'admissionType',
  'status',
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
    const values: NewTicketValues = {
      organizationId: actor.organizationId,
      eventId,
      name,
      isFree,
      priceSatang: isFree ? 0 : (input.priceSatang ?? 0),
      total: input.total ?? 0,
      admissionType: input.admissionType ?? 'general_admission',
      status: input.status ?? 'scheduled',
      minPerOrder: input.minPerOrder ?? 1,
      maxPerOrder: input.maxPerOrder ?? 8,
      salesStartAt: input.salesStartAt ?? null,
      salesEndAt: input.salesEndAt ?? null,
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
    if (input.total !== undefined && input.total < ticket.sold) {
      throw DomainException.validation(
        `Cannot set the quantity (${input.total}) below the ${ticket.sold} already sold.`,
      );
    }
    if (input.name !== undefined) {
      await this.assertNameFree(
        actor.organizationId,
        eventId,
        input.name.trim(),
        ticketId,
      );
    }
    const updated = await this.repo.update(
      actor.organizationId,
      ticketId,
      this.buildValues(input),
      ticket.version,
    );
    if (!updated) throw this.stale();
    return this.respond(actor.organizationId, updated);
  }

  async deleteTicket(
    actor: EventActor,
    eventId: string,
    ticketId: string,
  ): Promise<void> {
    const ticket = await this.load(actor.organizationId, eventId, ticketId);
    if (ticket.sold > 0) {
      throw DomainException.conflict(
        "This ticket type has sales and can't be removed. Close it instead.",
      );
    }
    const remaining = await this.repo.countActive(
      actor.organizationId,
      eventId,
    );
    if (remaining <= 1) {
      throw DomainException.validation(
        'An event must keep at least one ticket type — this is the last one.',
      );
    }
    await this.repo.softDelete(actor.organizationId, ticketId);
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
