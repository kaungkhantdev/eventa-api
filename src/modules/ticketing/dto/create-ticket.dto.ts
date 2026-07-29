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
import { admissionTypeEnum, ticketStatusEnum } from '../../../db/schema';
import type { AdmissionType, TicketStatus } from '../ticketing.types';

const ADMISSION: readonly AdmissionType[] = admissionTypeEnum.enumValues;
const STATUSES: readonly TicketStatus[] = ticketStatusEnum.enumValues;
const MAX_PER_ORDER = 8;

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

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: TicketStatus;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  minPerOrder?: number;

  @ApiPropertyOptional({ example: 8, minimum: 1, maximum: MAX_PER_ORDER })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PER_ORDER)
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
