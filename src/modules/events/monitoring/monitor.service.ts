import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../../common/errors/domain.exception';
import { Paginated } from '../../../common/http/paginated';
import { Clock } from '../../../common/time/clock';
import { daysLeft } from '../../../common/time/bangkok';
import type { Env } from '../../../config/env.validation';
import { Permission } from '../../identity/decorators/require-permissions.decorator';
import { PermissionsService } from '../../identity/permissions.service';
import { EventsRepository } from '../events.repository';
import type { EventActor, EventRow } from '../events.types';
import { EventStatsPort } from '../ports/event-stats.port';
import { AttendeeRowDto } from './dto/attendee-row.dto';
import { OverviewResponseDto } from './dto/overview-response.dto';
import {
  RegistrationRowDto,
  RegistrationsPageDto,
} from './dto/registrations-page.dto';
import type { RegistrationsQueryDto } from './dto/registrations.query.dto';
import type { AttendeesQueryDto } from './dto/attendees.query.dto';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * The event-workspace Monitor (US-EVT-14): Overview headline numbers, the
 * Registrations tab, and the Attendees tab. Reads registration/payment data only
 * through EventStatsPort (never those tables directly), and hides revenue from
 * callers without finance access.
 */
@Injectable()
export class MonitorService {
  private readonly publicWebUrl: string;

  constructor(
    private readonly repo: EventsRepository,
    private readonly stats: EventStatsPort,
    private readonly permissions: PermissionsService,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    this.publicWebUrl = config.getOrThrow('PUBLIC_WEB_URL', { infer: true });
  }

  /** Overview headline numbers; revenue is null unless the caller holds finView. */
  async overview(
    actor: EventActor,
    eventId: string,
  ): Promise<OverviewResponseDto> {
    const event = await this.loadEvent(actor.organizationId, eventId);
    const stats = await this.stats.overview(actor.organizationId, eventId);
    const canViewFinance = await this.canViewFinance(actor);
    return {
      registrations: stats.registrations,
      ticketsSold: stats.ticketsSold,
      capacity: event.capacity,
      fillPercent: fillPercent(stats.registrations, event.capacity),
      revenueSatang: canViewFinance ? stats.revenueSatang : null,
      daysLeft: daysLeft(this.clock.now(), event.startAt),
      publicUrl: `${this.publicWebUrl}/e/${event.slug}`,
    };
  }

  /** A page of the event's registrations plus the per-status badge counts. */
  async registrations(
    actor: EventActor,
    eventId: string,
    query: RegistrationsQueryDto,
  ): Promise<RegistrationsPageDto> {
    await this.loadEvent(actor.organizationId, eventId);
    const page = Math.max(1, query.page ?? 1);
    const limit = clampLimit(query.limit);
    const result = await this.stats.registrations(
      actor.organizationId,
      eventId,
      { status: query.status, limit, offset: (page - 1) * limit },
    );
    return {
      items: result.items.map(toRegistrationRow),
      statusCounts: result.statusCounts,
      page,
      limit,
      total: result.total,
      totalPages: Math.ceil(result.total / limit),
    };
  }

  /** A page of the event's confirmed attendees; the count badge is `meta.total`. */
  async attendees(
    actor: EventActor,
    eventId: string,
    query: AttendeesQueryDto,
  ): Promise<Paginated<AttendeeRowDto>> {
    await this.loadEvent(actor.organizationId, eventId);
    const page = Math.max(1, query.page ?? 1);
    const limit = clampLimit(query.limit);
    const result = await this.stats.attendees(actor.organizationId, eventId, {
      limit,
      offset: (page - 1) * limit,
    });
    return Paginated.of(result.items, result.total, page, limit);
  }

  private async loadEvent(
    organizationId: number,
    eventId: string,
  ): Promise<EventRow> {
    const event = await this.repo.findEvent(organizationId, eventId);
    if (!event) {
      throw DomainException.notFound(
        `Event ${eventId} not found in this workspace.`,
      );
    }
    return event;
  }

  private async canViewFinance(actor: EventActor): Promise<boolean> {
    const granted = await this.permissions.getFor(
      actor.organizationId,
      actor.userId,
    );
    return granted.includes(Permission.finView);
  }
}

function clampLimit(limit?: number): number {
  return Math.min(MAX_LIMIT, Math.max(1, limit ?? DEFAULT_LIMIT));
}

function fillPercent(registrations: number, capacity: number | null): number {
  if (!capacity || capacity <= 0) return 0;
  // Clamp to the documented 0–100 so an oversold event can't overflow a fill bar.
  return Math.min(100, Math.round((registrations / capacity) * 100));
}

function toRegistrationRow(row: {
  reference: string;
  attendeeName: string;
  tickets: number;
  amountSatang: number;
  paymentStatus: string;
  registeredAt: Date;
}): RegistrationRowDto {
  return {
    reference: row.reference,
    attendeeName: row.attendeeName,
    tickets: row.tickets,
    amountSatang: row.amountSatang,
    paymentStatus: row.paymentStatus,
    registeredAt: row.registeredAt.toISOString(),
  };
}
