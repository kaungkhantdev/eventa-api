import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { PlatformModule } from '../platform/platform.module';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsRepository } from './announcements.repository';
import { AnnouncementsService } from './announcements.service';

/**
 * The record of what a workspace has broadcast to its attendees (US-MSG-04).
 *
 * Exports its service because the send lives on the event Monitor
 * (`POST /events/:id/attendees/email`, US-EVT-14): that endpoint resolves the
 * audience and then hands the broadcast here, so the row and the outbox event
 * that actually sends it are written in one transaction.
 */
@Module({
  imports: [AccessModule, PlatformModule],
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService, AnnouncementsRepository],
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
