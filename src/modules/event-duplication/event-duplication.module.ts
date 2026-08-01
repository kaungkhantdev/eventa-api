import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { TicketingModule } from '../ticketing/ticketing.module';
import { EventsModule } from '../events/events.module';
import { EventProgramModule } from '../event-program/event-program.module';
import { EventSeatingModule } from '../event-seating/event-seating.module';
import { EventDuplicationController } from './event-duplication.controller';
import { EventDuplicationService } from './event-duplication.service';

/**
 * Duplicate-event use case (US-EVT-13). A leaf module that orchestrates the
 * Events, Ticketing, Program and Seating services to clone an event graph into a
 * fresh draft — depends on their service interfaces, never their tables.
 */
@Module({
  imports: [
    EventsModule,
    TicketingModule,
    EventProgramModule,
    EventSeatingModule,
    AccessModule,
  ],
  controllers: [EventDuplicationController],
  providers: [EventDuplicationService],
})
export class EventDuplicationModule {}
