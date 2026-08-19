import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { EventCategoriesController } from './event-categories.controller';
import { EventCategoriesRepository } from './event-categories.repository';
import { EventCategoriesService } from './event-categories.service';

/**
 * Event categories (US-EVT-11): CRUD over the org's category list with live event
 * counts. Depends on AccessModule for the RBAC PermissionsGuard only.
 */
@Module({
  imports: [AccessModule],
  controllers: [EventCategoriesController],
  providers: [EventCategoriesService, EventCategoriesRepository],
  exports: [EventCategoriesService],
})
export class EventCategoriesModule {}
