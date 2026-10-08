import { ApiProperty } from '@nestjs/swagger';
import { surveyQuestionTypeEnum, surveyStatusEnum } from '../../../db/schema';
import type { SurveyQuestionType, SurveyStatus } from '../survey-rules';

export class SurveyQuestionDto {
  @ApiProperty({ example: '12' })
  id!: string;

  @ApiProperty({ enum: surveyQuestionTypeEnum.enumValues })
  type!: SurveyQuestionType;

  @ApiProperty({ example: 'How would you rate the event overall?' })
  prompt!: string;

  @ApiProperty({
    type: [String],
    description: 'Only a `choice` question has these; it needs at least two.',
  })
  options!: string[];
}

/** A feedback survey and its questions (US-MSG-09). */
export class SurveyDto {
  @ApiProperty({ example: '7' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ example: 'Post-event feedback' })
  title!: string;

  @ApiProperty({
    enum: surveyStatusEnum.enumValues,
    description: 'A `draft` collects nothing. `closed` can be reopened.',
  })
  status!: SurveyStatus;

  @ApiProperty({ type: [SurveyQuestionDto] })
  questions!: SurveyQuestionDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
