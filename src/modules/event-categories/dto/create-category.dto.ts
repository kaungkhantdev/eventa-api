import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { categoryColorEnum } from '../../../db/schema';
import type { CategoryColor } from '../event-categories.types';

const COLORS: readonly CategoryColor[] = categoryColorEnum.enumValues;

export class CreateCategoryDto {
  @ApiProperty({ example: 'Conference', minLength: 1, maxLength: 40 })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  @ApiProperty({ example: 'presentation-01', description: 'Icon slug' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  icon!: string;

  @ApiProperty({ enum: COLORS, example: 'blue' })
  @IsIn(COLORS)
  color!: CategoryColor;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}
