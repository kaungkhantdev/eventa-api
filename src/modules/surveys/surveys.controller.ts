import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ApiData, ApiList } from '../../common/http/api-data.decorator';
import type { AuthContext } from '../auth/auth.types';
import { FeedbackSummaryQueryDto } from './dto/feedback-summary.query.dto';
import { FeedbackResponseDto, FeedbackSummaryDto } from './dto/response.dto';
import { SurveyDto } from './dto/survey.dto';
import {
  CreateSurveyDto,
  SetSurveyStatusDto,
  WriteSurveyDto,
} from './dto/write-survey.dto';
import { toSurvey } from './surveys.mapper';
import { SurveyResponsesService } from './responses.service';
import { SurveysService } from './surveys.service';

/**
 * Authoring feedback surveys (US-MSG-09).
 *
 * Gated on `evCreate`: a survey belongs to an event, and writing one is the
 * same kind of act as shaping the event itself.
 *
 * Every write answers with the survey as it now stands, so the editor never has
 * to guess what the server made of what it sent.
 */
@ApiTags('surveys')
@ApiBearerAuth()
@UseGuards(AdminGuard, PermissionsGuard)
@RequirePermissions(Permission.evCreate)
@ApiForbiddenResponse({
  type: ApiErrorDto,
  description: 'Writing a survey is an event permission.',
})
@Controller('surveys')
export class SurveysController {
  constructor(
    private readonly surveys: SurveysService,
    private readonly responses: SurveyResponsesService,
  ) {}

  @Get()
  @ResponseMessage('Surveys retrieved.')
  @ApiList(SurveyDto)
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query('eventId') eventId?: string,
  ): Promise<SurveyDto[]> {
    return (await this.surveys.list(auth, eventId)).map(toSurvey);
  }

  /**
   * What the answers add up to (US-MSG-08) — for one event, one survey, or the
   * whole workspace when neither is named.
   */
  @Get('summary')
  @ResponseMessage('Feedback summary retrieved.')
  @ApiData(FeedbackSummaryDto)
  summary(
    @CurrentAuth() auth: AuthContext,
    @Query() query: FeedbackSummaryQueryDto,
  ): Promise<FeedbackSummaryDto> {
    return this.responses.summary(auth, {
      eventId: query.eventId,
      surveyId: query.surveyId,
    });
  }

  /** How many people answered, per event — what the event cards show. */
  @Get('counts')
  @ResponseMessage('Response counts retrieved.')
  @ApiList(Object)
  counts(
    @CurrentAuth() auth: AuthContext,
  ): Promise<{ eventId: string; responses: number }[]> {
    return this.responses.countsByEvent(auth);
  }

  /** Individual responses for one event (US-MSG-10), filterable by rating. */
  @Get('responses')
  @ResponseMessage('Responses retrieved.')
  @ApiList(FeedbackResponseDto)
  async responsesFor(
    @CurrentAuth() auth: AuthContext,
    @Query('eventId') eventId: string,
    @Query('rating') rating?: string,
  ): Promise<FeedbackResponseDto[]> {
    const rows = await this.responses.list(
      auth,
      eventId,
      rating ? Number(rating) : undefined,
    );
    return rows.map((row) => ({
      id: row.id,
      surveyTitle: row.surveyTitle,
      personName: row.personName,
      rating: row.rating,
      comment: row.comment,
      submittedAt: row.submittedAt.toISOString(),
    }));
  }

  @Post()
  @ResponseMessage('Survey created.')
  @ApiData(SurveyDto)
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateSurveyDto,
  ): Promise<SurveyDto> {
    const { eventId, ...input } = dto;
    return toSurvey(await this.surveys.create(auth, eventId, input));
  }

  @Patch(':id')
  @ResponseMessage('Survey saved.')
  @ApiData(SurveyDto)
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: WriteSurveyDto,
  ): Promise<SurveyDto> {
    return toSurvey(await this.surveys.update(auth, id, dto));
  }

  @Patch(':id/status')
  @ResponseMessage('Survey updated.')
  @ApiData(SurveyDto)
  async setStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetSurveyStatusDto,
  ): Promise<SurveyDto> {
    return toSurvey(await this.surveys.setStatus(auth, id, dto.status));
  }

  /** 201: a duplicate is a new survey, not an edit of the one it copied. */
  @Post(':id/duplicate')
  @ResponseMessage('Survey duplicated.')
  @ApiData(SurveyDto)
  async duplicate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SurveyDto> {
    return toSurvey(await this.surveys.duplicate(auth, id));
  }

  @Delete(':id')
  @HttpCode(204)
  @ResponseMessage('Survey deleted.')
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.surveys.remove(auth, id);
  }
}
