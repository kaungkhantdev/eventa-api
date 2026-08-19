import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { CheckInModule } from '../check-in/check-in.module';
import { EventsModule } from '../events/events.module';
import { PaymentsModule } from '../payments/payments.module';
import { RegistrationsModule } from '../registrations/registrations.module';
import { TicketingModule } from '../ticketing/ticketing.module';
import { UsersModule } from '../users/users.module';
import { DashboardAnalyticsService } from './dashboard-analytics.service';
import { DashboardController } from './dashboard.controller';
import { DashboardHomeService } from './dashboard-home.service';

/**
 * The daily operations home and the analytics dashboard (E11).
 *
 * Two facets of one concern: `DashboardHomeService` answers "what needs me
 * today", `DashboardAnalyticsService` answers "how are we doing". They are
 * separate classes because they refresh on different cadences (US-DASH-13) and
 * because one service holding both would be well past the DI budget.
 *
 * This module owns NO data and writes none. It declares five consumer-owned
 * ports and each owning module binds the adapter, so summarizing sign-ups,
 * money, inventory, events and attendance never reaches into their tables:
 *   · `RegistrationInsightsPort` (Registrations) · `RevenueInsightsPort`
 *   (Payments) · `InventoryInsightsPort` (Ticketing) · `EventInsightsPort`
 *   (Events) · `CheckInInsightsPort` (Check-in).
 * `AccessModule` supplies `PermissionsService` — the per-panel gate — and
 * `UsersModule` the signed-in user's name for the greeting. No `forwardRef`:
 * nothing summarized here has any reason to ask the dashboard anything.
 */
@Module({
  imports: [
    AccessModule,
    UsersModule,
    RegistrationsModule,
    PaymentsModule,
    TicketingModule,
    EventsModule,
    CheckInModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardHomeService, DashboardAnalyticsService],
})
export class DashboardModule {}
