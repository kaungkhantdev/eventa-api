import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { CommonModule } from './common/common.module';
import { CorrelationIdMiddleware } from './common/context/correlation-id.middleware';
import { AppConfigModule } from './config/config.module';
import type { Env } from './config/env.validation';
import { buildLoggerOptions } from './config/logger.config';
import { DatabaseModule } from './db/database.module';
import { HealthModule } from './health/health.module';
import { DuplicationModule } from './modules/events/duplication/duplication.module';
import { EventsModule } from './modules/events/events.module';
import { ProgramModule } from './modules/events/program/program.module';
import { SeatingModule } from './modules/events/seating/seating.module';
import { IdentityModule } from './modules/identity/identity.module';
import { RegistrationModule } from './modules/registration/registration.module';
import { TicketingModule } from './modules/ticketing/ticketing.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        buildLoggerOptions(config),
    }),
    DatabaseModule,
    CommonModule,
    HealthModule,
    IdentityModule,
    EventsModule,
    TicketingModule,
    ProgramModule,
    SeatingModule,
    DuplicationModule,
    RegistrationModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Establish correlation id + request context for every request.
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
