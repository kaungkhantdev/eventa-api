import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

class HighlightDto {
  @ApiProperty({ example: 'Lunch and coffee included' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  text!: string;

  @ApiPropertyOptional({ nullable: true, example: 'coffee' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string | null;
}

class FaqDto {
  @ApiProperty({ example: 'Is there parking?' })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  question!: string;

  @ApiProperty({ example: 'Yes — free on level B2.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  answer!: string;
}

/** Replace the ordered highlight list (US-PAGE-04). Order = array order. */
export class SetHighlightsDto {
  @ApiProperty({ type: [HighlightDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HighlightDto)
  highlights!: HighlightDto[];
}

/** Replace the ordered FAQ list (US-PAGE-06). Order = array order. */
export class SetFaqsDto {
  @ApiProperty({ type: [FaqDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FaqDto)
  faqs!: FaqDto[];
}
