import { Module } from '@nestjs/common';
import { RegistrationStatsModule } from '../registration-stats/registration-stats.module';
import { DiscoverController } from './discover.controller';
import { DiscoverPolicy } from './discover.policy';
import { DiscoverRepository } from './discover.repository';
import { DiscoverService } from './discover.service';

/**
 * Discover: the anonymous attendee-facing browse grid (US-DISC-01) with its
 * keyword and category filters (US-DISC-02). Sibling to PublicPagesModule — that
 * one renders a single event's page, this one is how a visitor finds it.
 *
 * It owns `EventAttendancePort` ("how many are going") and imports
 * RegistrationStatsModule for the binding, so the registration read model stays
 * behind an abstraction. No `forwardRef`: nothing in Registration needs Discover.
 */
@Module({
  imports: [RegistrationStatsModule],
  controllers: [DiscoverController],
  providers: [DiscoverService, DiscoverRepository, DiscoverPolicy],
  exports: [DiscoverService],
})
export class DiscoverModule {}
