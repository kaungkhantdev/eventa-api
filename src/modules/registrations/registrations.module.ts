import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { RegistrationsController } from './registrations.controller';
import { RegistrationsRepository } from './registrations.repository';
import { RegistrationsService } from './registrations.service';

/**
 * Registrations: the organizer's cross-event sign-up workbench (US-REG-01),
 * and the home of the approve/reject rules in `registration-decision.ts`.
 *
 * Distinct from `registration` (singular), which owns the seat-hold engine —
 * this module reads orders for review, that one reserves inventory.
 * `AccessModule` supplies `PermissionsService`, used both for the route guard
 * and to decide whether the caller may see money at all.
 */
@Module({
  imports: [AccessModule],
  controllers: [RegistrationsController],
  providers: [RegistrationsService, RegistrationsRepository],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
