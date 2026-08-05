import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AttendeeTicketsController } from './attendee-tickets.controller';
import { AttendeeTicketsRepository } from './attendee-tickets.repository';
import { AttendeeTicketsService } from './attendee-tickets.service';

/**
 * Attendee tickets: the signed-in attendee's My Events split (US-DISC-09) and
 * each ticket's viewable, printable pass (US-DISC-07). A read model in the
 * mould of `registration-stats` — cross-tenant on purpose, scoped by the
 * PERSON: every query keys on the account's email, resolved server-side via
 * UsersModule from the token's user id. Read-only throughout; tickets are
 * minted and revoked elsewhere (checkout, payments, E8/E9).
 */
@Module({
  imports: [UsersModule],
  controllers: [AttendeeTicketsController],
  providers: [AttendeeTicketsService, AttendeeTicketsRepository],
  exports: [AttendeeTicketsService],
})
export class AttendeeTicketsModule {}
