import { Module } from '@nestjs/common';
import { EventSeatingModule } from '../event-seating/event-seating.module';
import { PublicPagesController } from './public-pages.controller';
import { PublicPagesRepository } from './public-pages.repository';
import { PublicPagesService } from './public-pages.service';

/**
 * The anonymous public event page (US-PAGE-01…08) — the surface a shared link,
 * a search result or the Discover listing lands on. Read-only; it starts
 * registration but never books, holds seats or exposes attendee data.
 *
 * Depends on EventSeatingModule for `PublicSeatMapPort` (declared in `ports/`,
 * bound there): how a reserved room's rows are split between the tickets.
 */
@Module({
  imports: [EventSeatingModule],
  controllers: [PublicPagesController],
  providers: [PublicPagesService, PublicPagesRepository],
  exports: [PublicPagesService],
})
export class PublicPagesModule {}
