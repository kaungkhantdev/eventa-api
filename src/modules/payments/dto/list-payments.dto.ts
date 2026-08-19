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
import { paymentMethodEnum, paymentStatusEnum } from '../../../db/schema';

const STATUSES = paymentStatusEnum.enumValues;
/** The three the story puts in scope for the ledger filter. */
const METHODS = ['Card', 'PromptPay', 'Bank transfer'] as const;
const MAX_LIMIT = 100;
const MAX_SEARCH = 120;

/** Filters for the finance ledger (US-FIN-01). */
export class ListPaymentsDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_LIMIT, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @ApiPropertyOptional({ enum: METHODS })
  @IsOptional()
  @IsIn(METHODS)
  method?: (typeof METHODS)[number];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  eventId?: string;

  @ApiPropertyOptional({
    description: 'Part of a payer name or a transaction reference',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SEARCH)
  search?: string;
}

/** One row of the ledger. */
export class LedgerEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'TXN-001' }) txn!: string;
  @ApiProperty({ example: 'Anan Suksawat' }) payerName!: string;
  @ApiProperty({ example: 'Bangkok Tech Week' }) eventName!: string;
  @ApiProperty({ enum: paymentMethodEnum.enumValues }) method!: string;

  @ApiProperty({
    example: 188000,
    description: 'VAT-inclusive, integer satang',
  })
  amountSatang!: number;

  @ApiProperty({ example: 'THB' }) currency!: string;
  @ApiProperty({ enum: STATUSES }) status!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  paidAt!: string | null;

  @ApiProperty({ description: 'False until a charge actually completed' })
  canViewInvoice!: boolean;

  @ApiProperty() canRefund!: boolean;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Why refunding is unavailable; null when it is available',
  })
  refundBlockedReason!: string | null;
}

/** Live totals for the status tabs — the whole ledger, not the page. */
export class LedgerCountsDto {
  @ApiProperty() paid!: number;
  @ApiProperty() pending!: number;
  @ApiProperty() refunded!: number;
  @ApiProperty() failed!: number;
}
