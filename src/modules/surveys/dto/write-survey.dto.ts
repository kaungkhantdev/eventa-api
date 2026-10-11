import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
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

/**
 * A save of an existing survey, carrying the version the editor loaded.
 *
 * Required, and deliberately not defaulted. Authoring replaces the whole
 * question set, so a save with no version would be a save that cannot be
 * refused — and the thing it silently overwrites is somebody else's question,
 * not a field. A client that has not read the survey has no business saving it.
 *
 * Not on `WriteSurveyDto` itself, because `CreateSurveyDto` extends that and a
 * survey being created has no prior version to compare against.
 */
export class UpdateSurveyDto extends WriteSurveyDto {
  @ApiProperty({
    example: 4,
    description:
      'The `version` from the survey you loaded. The save is refused with 409 if it has moved on.',
  })
  @IsInt()
  @Min(1)
  version!: number;
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
