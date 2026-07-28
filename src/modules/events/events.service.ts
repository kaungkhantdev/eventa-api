import { Injectable } from '@nestjs/common';
import { Paginated } from '../../common/http/paginated';
import { EventResponseDto } from './dto/event-response.dto';
import { toEventResponse } from './events.mapper';
import { EventsRepository } from './events.repository';
import type {
  CreateEventInput,
  EventActor,
  ListEventsOptions,
  ListEventsQuery,
  NewEventValues,
} from './events.types';
import { slugify } from './slug';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Orchestrates event management rules (the Events bounded context). */
@Injectable()
export class EventsService {
  constructor(private readonly repo: EventsRepository) {}

  /** Create an event in Draft; derives a unique per-org slug and defaults. */
  async createDraft(
    actor: EventActor,
    input: CreateEventInput,
  ): Promise<EventResponseDto> {
    const slug = await this.uniqueSlug(actor.organizationId, input.name);
    const organizerName =
      input.organizerName ??
      (await this.repo.organizationName(actor.organizationId));

    const values: NewEventValues = {
      organizationId: actor.organizationId,
      slug,
      name: input.name,
      type: input.type,
      status: 'draft',
      bucket: 'active',
      startAt: input.startAt,
      description: input.description ?? null,
      categoryId: input.categoryId ?? null,
      organizerName,
      createdBy: actor.userId,
    };
    return toEventResponse(await this.repo.insert(values));
  }

  /** The organizer's events for this tenant, filtered/sorted, one page at a time. */
  async list(
    actor: EventActor,
    query: ListEventsQuery,
  ): Promise<Paginated<EventResponseDto>> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, query.limit ?? DEFAULT_LIMIT),
    );
    const options: ListEventsOptions = {
      limit,
      offset: (page - 1) * limit,
      sort: query.sort ?? 'recent',
      ...(query.q ? { q: query.q } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.bucket ? { bucket: query.bucket } : {}),
    };
    const { items, total } = await this.repo.list(
      actor.organizationId,
      options,
    );
    return Paginated.of(items.map(toEventResponse), total, page, limit);
  }

  /** First slug of `slugify(name)`, `-2`, `-3`… not already taken in this org. */
  private async uniqueSlug(
    organizationId: number,
    name: string,
  ): Promise<string> {
    const base = slugify(name);
    const taken = new Set(await this.repo.existingSlugs(organizationId, base));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i += 1) {
      const candidate = `${base}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
  }
}
