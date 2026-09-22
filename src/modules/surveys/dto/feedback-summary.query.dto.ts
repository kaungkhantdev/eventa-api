import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

/**
 * Which answers the feedback summary is taken over (US-MSG-08). Neither: the
 * whole workspace. Every figure in the summary reads the same scope.
 */
export class FeedbackSummaryQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'One event.' })
  @IsOptional()
  @IsUUID()
  eventId?: string;

  @ApiPropertyOptional({ example: 7, description: 'One survey.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  surveyId?: number;
}
