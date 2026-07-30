import { Module } from '@nestjs/common';
import { IdentityModule } from '../../identity/identity.module';
import { TicketingModule } from '../../ticketing/ticketing.module';
import { EventsModule } from '../events.module';
import { ProgramModule } from '../program/program.module';
import { SeatingModule } from '../seating/seating.module';
import { DuplicationController } from './duplication.controller';
import { DuplicationService } from './duplication.service';

/**
 * Duplicate-event use case (US-EVT-13). A leaf module that orchestrates the
 * Events, Ticketing, Program and Seating services to clone an event graph into a
 * fresh draft — depends on their service interfaces, never their tables.
 */
@Module({
  imports: [
    EventsModule,
    TicketingModule,
    ProgramModule,
    SeatingModule,
    IdentityModule,
  ],
  controllers: [DuplicationController],
  providers: [DuplicationService],
})
export class DuplicationModule {}
