import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { EventsModule } from '../events/events.module';
import { EventPageContentController } from './event-page-content.controller';
import { EventPageContentRepository } from './event-page-content.repository';
import { EventPageContentService } from './event-page-content.service';

/**
 * Supplementary public-page content the organizer arranges: highlights
 * (US-PAGE-04) and FAQs (US-PAGE-06). Both are ordered lists replaced as a whole,
 * so the saved order is exactly what the page renders. Verifies the event through
 * the Events service — never its tables.
 */
@Module({
  imports: [EventsModule, AccessModule],
  controllers: [EventPageContentController],
  providers: [EventPageContentService, EventPageContentRepository],
  exports: [EventPageContentService],
})
export class EventPageContentModule {}
