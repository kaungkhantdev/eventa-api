import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { EventsModule } from '../events/events.module';
import { EventPageController } from './event-page.controller';
import { EventPageRepository } from './event-page.repository';
import { EventPageService } from './event-page.service';

/**
 * An event's public-page settings: which of the four designs it uses, the public
 * address it lives at, and its accent colour (US-PAGE-10), plus a live preview of
 * unsaved content (US-PAGE-09). Depends on the Events service to verify the event
 * belongs to the caller — never on the events tables. Publishing itself stays in
 * EventsModule, which owns the readiness gate.
 */
@Module({
  imports: [EventsModule, AccessModule],
  controllers: [EventPageController],
  providers: [EventPageService, EventPageRepository],
  exports: [EventPageService],
})
export class EventPageModule {}
