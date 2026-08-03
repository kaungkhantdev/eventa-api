import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const MAX_LIMIT = 48;
const MAX_TEXT = 120;

/** What an anonymous visitor may ask the Discover grid for (US-DISC-02). */
export class BrowseEventsDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_LIMIT, default: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    example: 'tech week',
    description: 'Matches title, category, city or venue — EN or TH',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT)
  q?: string;

  @ApiPropertyOptional({
    example: 'Technology',
    description: 'Omit for "All events"',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT)
  category?: string;
}
