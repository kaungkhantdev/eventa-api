import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AttendeeDirectoryController } from './attendee-directory.controller';
import { AttendeeDirectoryRepository } from './attendee-directory.repository';
import { AttendeeDirectoryService } from './attendee-directory.service';

/**
 * Attendee directory: who is coming, across every event (US-REG-05). A read
 * surface over `attendees` plus per-attendee aggregates from their orders and
 * tickets. `AccessModule` supplies `PermissionsService` for the `regView` gate.
 */
@Module({
  imports: [AccessModule],
  controllers: [AttendeeDirectoryController],
  providers: [AttendeeDirectoryService, AttendeeDirectoryRepository],
  exports: [AttendeeDirectoryService],
})
export class AttendeeDirectoryModule {}
