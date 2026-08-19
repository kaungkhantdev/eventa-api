import { Module } from '@nestjs/common';
import { DiscoverModule } from '../discover/discover.module';
import { SavedEventsController } from './saved-events.controller';
import { SavedEventsRepository } from './saved-events.repository';
import { SavedEventsService } from './saved-events.service';

/**
 * Saved events (US-DISC-03): the heart on a Discover card, kept against the
 * attendee's account so it follows them to another device, and adopted from a
 * guest session at sign-in.
 *
 * Depends on `DiscoverService` — never on its repository — for two things: the
 * card a saved event renders as, and the single answer to "is this event
 * publicly visible?", which is what stops a save becoming a handle on a private
 * event. `saved_events` is keyed by user rather than workspace; see the schema.
 */
@Module({
  imports: [DiscoverModule],
  controllers: [SavedEventsController],
  providers: [SavedEventsService, SavedEventsRepository],
  exports: [SavedEventsService],
})
export class SavedEventsModule {}
