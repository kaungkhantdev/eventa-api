import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsInt, IsOptional } from 'class-validator';
import { CreateCategoryDto } from './create-category.dto';

/** All create fields optional, plus an optimistic-concurrency token. */
export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {
  @ApiPropertyOptional({
    description: 'Optimistic-concurrency token (from GET)',
  })
  @IsOptional()
  @IsInt()
  version?: number;
}
