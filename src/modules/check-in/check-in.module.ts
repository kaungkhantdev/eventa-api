import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { EventsModule } from '../events/events.module';
import { CheckInController } from './check-in.controller';
import { CheckInRepository } from './check-in.repository';
import { CheckInService } from './check-in.service';

/**
 * Check-in: the door. Sole writer of `check_ins` and of the `tickets`
 * check-in projection (US-REG-11/12/13).
 *
 * It reads the event it is admitting to through `CheckInEventPort`, which
 * Events binds — so the door never touches another context's tables, and
 * resolving the event doubles as the tenancy check. `AccessModule` supplies
 * `PermissionsService` for the `regCheckin` gate.
 */
@Module({
  imports: [AccessModule, EventsModule],
  controllers: [CheckInController],
  providers: [CheckInService, CheckInRepository],
  exports: [CheckInService],
})
export class CheckInModule {}
