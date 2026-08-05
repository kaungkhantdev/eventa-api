import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AttendeePaymentsController } from './attendee-payments.controller';
import { AttendeePaymentsRepository } from './attendee-payments.repository';
import { AttendeePaymentsService } from './attendee-payments.service';

/**
 * Attendee payments: the signed-in attendee's payment history, VAT receipts and
 * CSV export (US-DISC-10). Prefix-sibling of `attendee-tickets` and the same
 * shape of read model — cross-tenant on purpose, scoped by the PERSON via the
 * account email UsersModule resolves from the token. Read-only; the ledger is
 * written by the payments module, refunds by E9.
 */
@Module({
  imports: [UsersModule],
  controllers: [AttendeePaymentsController],
  providers: [AttendeePaymentsService, AttendeePaymentsRepository],
  exports: [AttendeePaymentsService],
})
export class AttendeePaymentsModule {}
