import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { EventsModule } from '../events/events.module';
import { UsersModule } from '../users/users.module';
import { MySurveysController } from './my-surveys.controller';
import { SurveyResponsesRepository } from './responses.repository';
import { SurveyResponsesService } from './responses.service';
import { SurveysController } from './surveys.controller';
import { SurveysRepository } from './surveys.repository';
import { SurveysService } from './surveys.service';

/**
 * Feedback survey authoring (US-MSG-09). Reads EventsModule so a survey can
 * only ever attach to an event the caller's workspace actually owns.
 */
@Module({
  imports: [AccessModule, EventsModule, UsersModule],
  controllers: [SurveysController, MySurveysController],
  providers: [
    SurveysService,
    SurveysRepository,
    SurveyResponsesService,
    SurveyResponsesRepository,
  ],
  exports: [SurveysService],
})
export class SurveysModule {}
