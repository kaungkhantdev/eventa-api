import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional } from 'class-validator';
import { templateIdEnum, visibilityEnum } from '../../../db/schema';
import type { TemplateId, Visibility } from '../events.types';

const VISIBILITIES: readonly Visibility[] = visibilityEnum.enumValues;
const TEMPLATES: readonly TemplateId[] = templateIdEnum.enumValues;

/** Options applied when taking a draft live (US-EVT-07). */
export class PublishEventDto {
  @ApiPropertyOptional({
    enum: VISIBILITIES,
    description: 'Who can see the event once it is live',
  })
  @IsOptional()
  @IsIn(VISIBILITIES)
  visibility?: Visibility;

  @ApiPropertyOptional({
    enum: TEMPLATES,
    description: 'Public landing-page template',
  })
  @IsOptional()
  @IsIn(TEMPLATES)
  landingTemplateId?: TemplateId;

  @ApiPropertyOptional({
    description: 'Publish even though the start date is already in the past',
  })
  @IsOptional()
  @IsBoolean()
  confirmPastStart?: boolean;

  @ApiPropertyOptional({
    description: 'Optimistic-concurrency token (from GET)',
  })
  @IsOptional()
  @IsInt()
  version?: number;
}
