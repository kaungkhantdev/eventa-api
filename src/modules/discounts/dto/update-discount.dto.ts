import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsInt, IsOptional } from 'class-validator';
import { CreateDiscountDto } from './create-discount.dto';

/** All create fields optional, plus an optimistic-concurrency token. */
export class UpdateDiscountDto extends PartialType(CreateDiscountDto) {
  @ApiPropertyOptional({
    description: 'Optimistic-concurrency token (from GET)',
  })
  @IsOptional()
  @IsInt()
  version?: number;
}
