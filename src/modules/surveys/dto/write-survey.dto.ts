import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { surveyQuestionTypeEnum, surveyStatusEnum } from '../../../db/schema';
import type { SurveyQuestionType, SurveyStatus } from '../survey-rules';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Shape only. Whether a survey is ANSWERABLE is a domain rule, not a shape. */
export class SurveyQuestionInputDto {
  @ApiProperty({ enum: surveyQuestionTypeEnum.enumValues })
  @IsIn(surveyQuestionTypeEnum.enumValues)
  type!: SurveyQuestionType;

  @ApiProperty({ maxLength: 300 })
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  prompt!: string;

  @ApiPropertyOptional({ type: [String], maxItems: 20 })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  options: string[] = [];
}

export class WriteSurveyDto {
  @ApiProperty({ maxLength: 150 })
  @Transform(trim)
  @IsString()
  @MaxLength(150)
  title!: string;

  @ApiProperty({ type: [SurveyQuestionInputDto], maxItems: 30 })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => SurveyQuestionInputDto)
  questions!: SurveyQuestionInputDto[];
}

export class CreateSurveyDto extends WriteSurveyDto {
  @ApiProperty({ format: 'uuid', description: 'The event it asks about.' })
  @IsUUID()
  eventId!: string;
}

export class SetSurveyStatusDto {
  @ApiProperty({
    enum: surveyStatusEnum.enumValues,
    description: 'Nothing returns to `draft` — see the transition rules.',
  })
  @IsIn(surveyStatusEnum.enumValues)
  status!: SurveyStatus;
}
