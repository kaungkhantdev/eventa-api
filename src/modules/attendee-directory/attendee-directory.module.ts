import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AttendeeContactService } from './attendee-contact.service';
import { AttendeeDirectoryController } from './attendee-directory.controller';
import { AttendeeDirectoryRepository } from './attendee-directory.repository';
import { AttendeeDirectoryService } from './attendee-directory.service';

/**
 * Attendee directory: who is coming, across every event (US-REG-05), and
 * keeping their contact details current (US-REG-08). A read surface over
 * `attendees` plus per-attendee aggregates from their orders and tickets, with
 * one write — the contact correction, which is a facet of the same concern and
 * so a second service rather than a sibling module (it would otherwise have to
 * reach into this module's repository). `AccessModule` supplies
 * `PermissionsService` for the `regView` / `regManage` gates.
 */
@Module({
  imports: [AccessModule],
  controllers: [AttendeeDirectoryController],
  providers: [
    AttendeeDirectoryService,
    AttendeeContactService,
    AttendeeDirectoryRepository,
  ],
  exports: [AttendeeDirectoryService, AttendeeContactService],
})
export class AttendeeDirectoryModule {}
