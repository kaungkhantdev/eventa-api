import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { PaymentsModule } from '../payments/payments.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { RegistrationStatsModule } from '../registration-stats/registration-stats.module';
import { NotificationFeedService } from './notification-feed.service';
import { NotificationReadsRepository } from './notification-reads.repository';
import { NotificationsController } from './notifications.controller';

/**
 * The organizer's notification feed (US-MSG-03). Read-only, apart from one
 * timestamp.
 *
 * Nothing in the product writes a notification. The feed is DERIVED from what
 * already happened — registrations, payments, declines and payouts — each read
 * through a port this module declares and the owning module implements. That is
 * why there is no notifications table: a stored copy would be a second version
 * of events that already have a home, and it would start empty for everything
 * that happened before the feature shipped.
 *
 * The only thing stored is `notification_reads`: one instant per member saying
 * how far they have read.
 *
 * AccessModule is here for `PermissionsService` — not for the controller's
 * guard, which requires nothing, but for the service, which decides per reader
 * which sources to query at all.
 */
@Module({
  imports: [
    AccessModule,
    PaymentsModule,
    PayoutsModule,
    RegistrationStatsModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationFeedService, NotificationReadsRepository],
})
export class NotificationsModule {}
