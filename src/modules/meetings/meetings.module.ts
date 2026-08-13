import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { PlatformModule } from '../platform/platform.module';
import { MeetingsController } from './meetings.controller';
import { MeetingsQueryService } from './meetings-query.service';
import { MeetingsRepository } from './meetings.repository';
import { MeetingsService } from './meetings.service';

/**
 * Meetings: the organizer's coordination diary (E12) — venue walkthroughs,
 * sponsor calls, speaker briefings.
 *
 * Two facets of one concern: `MeetingsService` books and changes meetings,
 * `MeetingsQueryService` reads the Today/Upcoming/Past list. They are separate
 * classes because the read path needs the event-name resolution and paging that
 * the write path has no use for.
 *
 * `MeetingEventPort` (bound by Events) supplies the event's name and venue —
 * this module never joins `events`, and resolving the id through the port IS
 * the check that the event belongs to this workspace. `PlatformModule` supplies
 * the outbox: the calendar invite, the Meet link and the reminder are side
 * effects handled by the worker, never awaited in the request. No `forwardRef`
 * — nothing needs the diary back.
 */
@Module({
  imports: [EventsModule, PlatformModule],
  controllers: [MeetingsController],
  providers: [MeetingsService, MeetingsQueryService, MeetingsRepository],
  exports: [MeetingsService],
})
export class MeetingsModule {}
