import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { deliveryStatusEnum } from '../../../db/schema';
import type { DeliveryStatus } from '../message-deliveries.repository';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Filter and paging for the delivery log. */
export class DeliveriesQueryDto {
  @ApiPropertyOptional({ enum: deliveryStatusEnum.enumValues })
  @IsOptional()
  @IsIn(deliveryStatusEnum.enumValues)
  status?: DeliveryStatus;

  @ApiPropertyOptional({ example: 'registration-confirmation' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  kind?: string;

  @ApiPropertyOptional({
    description: 'Matches the recipient’s name or address.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
