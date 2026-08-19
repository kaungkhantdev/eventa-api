import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { discountTypeEnum } from '../../../db/schema';
import type { DiscountType } from '../discounts.types';

const TYPES: readonly DiscountType[] = discountTypeEnum.enumValues;
const CODE_MIN = 3;
const CODE_MAX = 24;

export class CreateDiscountDto {
  @ApiProperty({ example: 'PROMO42', minLength: CODE_MIN, maxLength: CODE_MAX })
  @IsString()
  @MinLength(CODE_MIN)
  @MaxLength(CODE_MAX)
  code!: string;

  @ApiProperty({ enum: TYPES })
  @IsIn(TYPES)
  type!: DiscountType;

  @ApiProperty({
    example: 25,
    description: 'Percent 1–100, or a fixed amount in satang',
  })
  @IsInt()
  @Min(1)
  value!: number;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Omit or null to apply the code to every event',
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  eventId?: string | null;

  @ApiPropertyOptional({ example: 500, description: '0 = unlimited' })
  @IsOptional()
  @IsInt()
  @Min(0)
  redemptionLimit?: number;

  @ApiPropertyOptional({ example: 1, description: '0 = unlimited per buyer' })
  @IsOptional()
  @IsInt()
  @Min(0)
  perPersonLimit?: number;

  @ApiPropertyOptional({
    example: 100000,
    description: 'Minimum order (satang)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  minOrderSatang?: number;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsISO8601()
  validFrom?: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsISO8601()
  validUntil?: string | null;
}
