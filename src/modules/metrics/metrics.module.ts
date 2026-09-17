import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { OutboxLagRepository } from './outbox-lag.repository';

/** Prometheus exposition for the API, including the outbox backlog gauges. */
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, OutboxLagRepository],
})
export class MetricsModule {}
