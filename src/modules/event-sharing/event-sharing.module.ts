import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { EventsModule } from '../events/events.module';
import { EventSharingController } from './event-sharing.controller';
import { EventSharingService } from './event-sharing.service';

/**
 * Event promotion (US-EVT-15): share links and the printable promo message.
 * Depends on the Events service to resolve the event in the caller's tenant —
 * never on the events tables directly.
 */
@Module({
  imports: [EventsModule, AccessModule],
  controllers: [EventSharingController],
  providers: [EventSharingService],
  exports: [EventSharingService],
})
export class EventSharingModule {}
