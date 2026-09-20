import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_RATING, MIN_RATING } from '../response-rules';
import { SurveyQuestionDto } from './survey.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** The live survey an attendee is being asked, if there is one. */
export class MySurveyDto {
  @ApiProperty({ type: String, nullable: true, example: '7' })
  surveyId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  title!: string | null;

  @ApiProperty({ type: [SurveyQuestionDto] })
  questions!: SurveyQuestionDto[];

  @ApiProperty({
    description:
      'True once this account has answered. Each person answers once, so the form is not offered again.',
  })
  answered!: boolean;
}

export class SubmitAnswerDto {
  @ApiProperty({ example: '12' })
  @IsString()
  questionId!: string;

  @ApiPropertyOptional({ minimum: MIN_RATING, maximum: MAX_RATING })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_RATING)
  @Max(MAX_RATING)
  rating?: number;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  answerText?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  choice?: string;
}

export class SubmitResponseDto {
  @ApiProperty({ type: [SubmitAnswerDto], maxItems: 30 })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => SubmitAnswerDto)
  answers!: SubmitAnswerDto[];
}

/** What a workspace's feedback adds up to (US-MSG-08). */
export class FeedbackSummaryDto {
  @ApiProperty({ example: 42 })
  responses!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 4.3,
    description:
      'Null when nobody has rated anything — never 0, which is a verdict.',
  })
  average!: number | null;

  @ApiProperty({
    description: 'How many gave each star, 1 to 5.',
    example: { 1: 0, 2: 1, 3: 4, 4: 12, 5: 25 },
  })
  distribution!: Record<number, number>;
}

/** One person's response (US-MSG-10). */
export class FeedbackResponseDto {
  @ApiProperty({ example: '31' })
  id!: string;

  @ApiProperty({ example: 'Post-event feedback' })
  surveyTitle!: string;

  @ApiProperty({ example: 'Anong Pattana' })
  personName!: string;

  @ApiProperty({ type: Number, nullable: true, example: 5 })
  rating!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Their free text, when the survey asked for any.',
  })
  comment!: string | null;

  @ApiProperty({ format: 'date-time' })
  submittedAt!: string;
}
