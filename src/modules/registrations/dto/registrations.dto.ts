import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { orderStatusEnum, paymentStatusEnum } from '../../../db/schema';
import type {
  RegistrationPayment,
  RegistrationStatus,
} from '../registrations.types';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
const MAX_SEARCH = 120;

/** Narrow the registrations queue (US-REG-01). */
export class ListRegistrationsDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_LIMIT,
    default: DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ enum: orderStatusEnum.enumValues })
  @IsOptional()
  @IsIn(orderStatusEnum.enumValues)
  status?: RegistrationStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  eventId?: string;

  @ApiPropertyOptional({ description: 'Attendee name, email or reference.' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SEARCH)
  search?: string;
}

export class RegistrationEntryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'ORD-2026-0009' })
  reference!: string;

  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ example: 'Bangkok Tech Week' })
  eventName!: string;

  @ApiProperty({ example: 'Anan Suksawat' })
  buyerName!: string;

  @ApiProperty({ example: 'anan@example.com' })
  buyerEmail!: string;

  @ApiProperty({ enum: orderStatusEnum.enumValues })
  status!: RegistrationStatus;

  @ApiProperty({ enum: paymentStatusEnum.enumValues })
  paymentStatus!: RegistrationPayment;

  @ApiProperty({ example: 2 })
  seats!: number;

  @ApiProperty({
    nullable: true,
    description: 'Null when the caller lacks finance access (US-REG-01).',
  })
  totalSatang!: number | null;

  @ApiProperty({ nullable: true, example: 'Free' })
  amountLabel!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  registeredAt!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  confirmedAt!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  rejectedAt!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  cancelledAt!: string | null;

  @ApiProperty()
  canApprove!: boolean;

  @ApiProperty({ nullable: true })
  approveBlockedReason!: string | null;

  @ApiProperty()
  canReject!: boolean;

  @ApiProperty({ nullable: true })
  rejectBlockedReason!: string | null;
}

/** Live tab totals across the whole filtered queue. */
export class RegistrationCountsDto {
  @ApiProperty() pending!: number;
  @ApiProperty() confirmed!: number;
  @ApiProperty() waitlisted!: number;
  @ApiProperty() cancelled!: number;
  @ApiProperty() rejected!: number;
}
