import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsIn,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_SEATS_PER_BOOKING } from '../../../common/booking/booking.limits';
import { admissionTypeEnum } from '../../../db/schema';
import type { AdmissionType } from '../ticketing.types';

const ADMISSION: readonly AdmissionType[] = admissionTypeEnum.enumValues;

export class CreateTicketDto {
  @ApiProperty({ example: 'VIP', minLength: 1, maxLength: 60 })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isFree?: boolean;

  @ApiPropertyOptional({
    example: 89000,
    description: 'VAT-inclusive gross price in satang',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  priceSatang?: number;

  @ApiPropertyOptional({ example: 100, description: 'Quantity / allocation' })
  @IsOptional()
  @IsInt()
  @Min(0)
  total?: number;

  @ApiPropertyOptional({ enum: ADMISSION })
  @IsOptional()
  @IsIn(ADMISSION)
  admissionType?: AdmissionType;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  minPerOrder?: number;

  @ApiPropertyOptional({
    example: 8,
    minimum: 1,
    maximum: MAX_SEATS_PER_BOOKING,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_SEATS_PER_BOOKING)
  maxPerOrder?: number;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  salesStartAt?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  salesEndAt?: string;
}
