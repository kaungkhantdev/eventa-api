import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { EventsModule } from '../events/events.module';
import { PlatformModule } from '../platform/platform.module';
import { InvitationsController } from './invitations.controller';
import { InvitationsRepository } from './invitations.repository';
import { InvitationsService } from './invitations.service';

/**
 * Invitations: asking a named person to one event (US-REG-06). Owns
 * `event_invitations` and nothing else — an invite reserves no seat, so this
 * module never touches capacity, holds or tickets.
 *
 * The event is resolved through `EventsService`, which doubles as the tenancy
 * check; `PlatformModule` supplies the outbox the email rides on.
 */
@Module({
  imports: [AccessModule, EventsModule, PlatformModule],
  controllers: [InvitationsController],
  providers: [InvitationsService, InvitationsRepository],
  exports: [InvitationsService],
})
export class InvitationsModule {}
