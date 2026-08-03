import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { Paginated } from '../../common/http/paginated';
import { DiscoverService } from '../discover/discover.service';
import type { EventCardDto } from '../discover/dto/event-card.dto';
import { SavedEventsRepository } from './saved-events.repository';
import type { SavedEventsQuery } from './saved-events.types';

/** Matches the Discover grid — a saved list is the same cards, kept. */
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 48;
const FIRST_PAGE = 1;

/**
 * An attendee's saved events (US-DISC-03) — the heart on a Discover card, kept
 * server-side so it follows them to another device.
 *
 * Two rules do the work. Nothing is saved that the attendee could not have seen:
 * every id is checked against Discover's own visibility before it is written, so
 * a save can never become a handle on a private event. And nothing is shown that
 * has since been taken down: the list renders whatever is still public, so an
 * unpublished event quietly leaves the list without the save being lost.
 */
@Injectable()
export class SavedEventsService {
  constructor(
    private readonly repo: SavedEventsRepository,
    private readonly discover: DiscoverService,
  ) {}

  /** Save an event. Tapping the heart twice is the same as tapping it once. */
  async save(userId: string, eventId: string): Promise<void> {
    const [card] = await this.discover.cardsByIds([eventId]);
    if (!card) throw DomainException.notFound("This event isn't available.");
    await this.repo.save(userId, eventId);
  }

  /** Unsave. Removing a save that was never there is a no-op, not an error. */
  async unsave(userId: string, eventId: string): Promise<void> {
    await this.repo.unsave(userId, eventId);
  }

  /**
   * Adopt the saves a guest made before signing in. The unique pair on
   * `saved_events` is what makes "with no duplicates" true no matter how many
   * times the browser replays the list.
   */
  async merge(userId: string, eventIds: string[]): Promise<{ merged: number }> {
    const wanted = [...new Set(eventIds)];
    if (wanted.length === 0) return { merged: 0 };
    // Ids that no longer resolve are dropped quietly — a sign-in must not fail
    // because an event the guest liked was taken down while they browsed.
    const visible = await this.discover.cardsByIds(wanted);
    if (visible.length === 0) return { merged: 0 };
    const merged = await this.repo.saveMany(
      userId,
      visible.map((c) => c.id),
    );
    return { merged };
  }

  async list(
    userId: string,
    query: SavedEventsQuery,
  ): Promise<Paginated<EventCardDto>> {
    const page = Math.max(FIRST_PAGE, query.page ?? FIRST_PAGE);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, query.limit ?? DEFAULT_LIMIT),
    );
    const { ids, total } = await this.repo.listEventIds(userId, {
      limit,
      offset: (page - FIRST_PAGE) * limit,
    });
    const cards = ids.length === 0 ? [] : await this.discover.cardsByIds(ids);
    return Paginated.of(cards, total, page, limit);
  }
}
