import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { CommonModule } from './common/common.module';
import { CorrelationIdMiddleware } from './common/context/correlation-id.middleware';
import { RedisModule } from './common/redis/redis.module';
import { AppConfigModule } from './config/config.module';
import type { Env } from './config/env.validation';
import { buildLoggerOptions } from './config/logger.config';
import { DatabaseModule } from './db/database.module';
import { HealthModule } from './health/health.module';
import { EventCategoriesModule } from './modules/event-categories/event-categories.module';
import { EventDuplicationModule } from './modules/event-duplication/event-duplication.module';
import { EventMonitoringModule } from './modules/event-monitoring/event-monitoring.module';
import { EventPageModule } from './modules/event-page/event-page.module';
import { EventPageContentModule } from './modules/event-page-content/event-page-content.module';
import { DiscountsModule } from './modules/discounts/discounts.module';
import { EventsModule } from './modules/events/events.module';
import { NotificationPreferencesModule } from './modules/notification-preferences/notification-preferences.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { PaymentSettingsModule } from './modules/payment-settings/payment-settings.module';
import { EventProgramModule } from './modules/event-program/event-program.module';
import { EventSeatingModule } from './modules/event-seating/event-seating.module';
import { EventSharingModule } from './modules/event-sharing/event-sharing.module';
import { AccessModule } from './modules/access/access.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthPasswordModule } from './modules/auth-password/auth-password.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthSessionsModule } from './modules/auth-sessions/auth-sessions.module';
import { AuthTwoFactorModule } from './modules/auth-two-factor/auth-two-factor.module';
import { AuthSignupModule } from './modules/auth-signup/auth-signup.module';
import { AuthSocialModule } from './modules/auth-social/auth-social.module';
import { UsersModule } from './modules/users/users.module';
import { PublicPagesModule } from './modules/public-pages/public-pages.module';
import { RegistrationModule } from './modules/registration/registration.module';
import { RegistrationStatsModule } from './modules/registration-stats/registration-stats.module';
import { TicketSharingModule } from './modules/ticket-sharing/ticket-sharing.module';
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
    RedisModule,
    HealthModule,
    AuthModule,
    UsersModule,
    AuthSignupModule,
    AuthSocialModule,
    AuthPasswordModule,
    AuthSessionsModule,
    AuthTwoFactorModule,
    AuditModule,
    AccessModule,
    OrganizationModule,
    NotificationPreferencesModule,
    PaymentSettingsModule,
    EventsModule,
    TicketingModule,
    TicketSharingModule,
    DiscountsModule,
    EventCategoriesModule,
    EventProgramModule,
    EventSeatingModule,
    EventDuplicationModule,
    EventSharingModule,
    EventMonitoringModule,
    EventPageModule,
    EventPageContentModule,
    PublicPagesModule,
    RegistrationModule,
    RegistrationStatsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Establish correlation id + request context for every request.
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
