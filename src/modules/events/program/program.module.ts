import { Module } from '@nestjs/common';
import { IdentityModule } from '../../identity/identity.module';
import { EventsModule } from '../events.module';
import { SessionsController } from './sessions.controller';
import { SessionsRepository } from './sessions.repository';
import { SessionsService } from './sessions.service';
import { SpeakersController } from './speakers.controller';
import { SpeakersRepository } from './speakers.repository';
import { SpeakersService } from './speakers.service';

/**
 * Program sub-context of Events & Program: agenda sessions and the speaker
 * line-up. Depends on the Events service (to verify the event is in the caller's
 * tenant) and IdentityModule (the RBAC PermissionsGuard) — never on the events
 * tables directly.
 */
@Module({
  imports: [EventsModule, IdentityModule],
  controllers: [SpeakersController, SessionsController],
  providers: [
    SpeakersService,
    SpeakersRepository,
    SessionsService,
    SessionsRepository,
  ],
  exports: [SpeakersService, SessionsService],
})
export class ProgramModule {}
