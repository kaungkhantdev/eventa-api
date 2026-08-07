import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { RegistrationDecisionsService } from './registration-decisions.service';
import { RegistrationEntryService } from './registration-entry.service';
import { RegistrationsController } from './registrations.controller';
import { RegistrationsRepository } from './registrations.repository';
import { RegistrationsService } from './registrations.service';
import { RegistrationInsightsPort } from '../dashboard/ports/registration-insights.port';
import { RegistrationInsightsAdapter } from './registration-insights.adapter';

/**
 * Registrations: the organizer's cross-event sign-up workbench (US-REG-01) and
 * the decisions taken on it (US-REG-02). Two facets of one concern —
 * `RegistrationsService` reads the queue, `RegistrationDecisionsService`
 * approves and rejects from it — with the rules themselves in
 * `registration-decision.ts`.
 *
 * Distinct from `registration` (singular), which owns the seat-hold engine —
 * this module reads orders for review, that one reserves inventory.
 * `AccessModule` supplies `PermissionsService`, used both for the route guard
 * and to decide whether the caller may see money at all. `CheckoutModule` binds
 * both consumer-owned ports — `RegistrationApprovalPort` (approving must run THE
 * settlement transaction) and `RegistrationEntryPort` (a hand-added booking is
 * priced, reserved and placed by the attendee checkout's own code) — so this
 * module never touches orders, tickets, tiers or seat holds itself. No
 * `forwardRef` — Checkout has no reason to ask the queue anything back.
 */
@Module({
  imports: [AccessModule, CheckoutModule],
  controllers: [RegistrationsController],
  providers: [
    {
      provide: RegistrationInsightsPort,
      useClass: RegistrationInsightsAdapter,
    },
    RegistrationsService,
    RegistrationDecisionsService,
    RegistrationEntryService,
    RegistrationsRepository,
  ],
  exports: [RegistrationInsightsPort, RegistrationsService],
})
export class RegistrationsModule {}
