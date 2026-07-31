import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { AccessModule } from '../access/access.module';
import { PlatformModule } from '../platform/platform.module';
import { RegistrationModule } from '../registration/registration.module';
import { AttendeeBroadcastService } from './attendee-broadcast.service';
import { EventMonitoringController } from './event-monitoring.controller';
import { EventMonitoringService } from './event-monitoring.service';

/**
 * Event-workspace Monitor (US-EVT-14): overview, registrations and attendees for a
 * single event, plus the "email all attendees" broadcast request. Reads through the
 * EventStatsPort (implemented by Registration) and writes the broadcast request to
 * the outbox (PlatformModule) — never another module's tables.
 */
@Module({
  imports: [EventsModule, AccessModule, PlatformModule, RegistrationModule],
  controllers: [EventMonitoringController],
  providers: [EventMonitoringService, AttendeeBroadcastService],
})
export class EventMonitoringModule {}
