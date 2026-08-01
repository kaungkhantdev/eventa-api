import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationPreferencesRepository } from './notification-preferences.repository';
import { NotificationPreferencesService } from './notification-preferences.service';

/**
 * Per-topic email/SMS choices (US-SET-06). Gates optional alerts only — receipts
 * and other required transactional messages always send. Reads the caller's phone
 * through UsersModule's ProfileService (never the users table) to know whether the
 * SMS switches are even available.
 */
@Module({
  imports: [UsersModule],
  controllers: [NotificationPreferencesController],
  providers: [
    NotificationPreferencesService,
    NotificationPreferencesRepository,
  ],
  exports: [NotificationPreferencesService],
})
export class NotificationPreferencesModule {}
