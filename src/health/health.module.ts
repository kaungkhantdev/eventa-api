import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

// DatabaseModule is @Global, so DRIZZLE is injectable here without importing it.
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
