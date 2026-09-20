import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiData } from '../../common/http/api-data.decorator';
import type { AuthContext } from '../auth/auth.types';
import { MySurveyDto, SubmitResponseDto } from './dto/response.dto';
import { SurveyResponsesService } from './responses.service';

/**
 * The attendee's side of feedback (US-MSG-08).
 *
 * Signed-in only, and every route acts on the CALLER — there is no path that
 * answers on somebody else's behalf. A survey is only offered to a person with
 * a confirmed registration for that event, and each of them answers once;
 * without both, a rating is a number anyone holding the link can move.
 */
@ApiTags('attendee-surveys')
@ApiBearerAuth()
@Controller('me/surveys')
export class MySurveysController {
  constructor(private readonly responses: SurveyResponsesService) {}

  @Get(':eventId')
  @ResponseMessage('Survey retrieved.')
  @ApiData(MySurveyDto)
  async mine(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<MySurveyDto> {
    const { survey, answered } = await this.responses.mySurvey(auth, eventId);
    return {
      surveyId: survey ? String(survey.id) : null,
      title: survey?.title ?? null,
      answered,
      questions: (survey?.questions ?? []).map((question) => ({
        id: String(question.id),
        type: question.type,
        prompt: question.prompt,
        options: question.options,
      })),
    };
  }

  /** 200, not 201: what was created is the person's answer, not a resource. */
  @Post(':eventId')
  @HttpCode(200)
  @ResponseMessage('Thanks for your feedback.')
  async submit(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: SubmitResponseDto,
  ): Promise<void> {
    await this.responses.submit(
      auth,
      eventId,
      dto.answers.map((answer) => ({
        questionId: Number(answer.questionId),
        rating: answer.rating,
        answerText: answer.answerText,
        choice: answer.choice,
      })),
    );
  }
}
