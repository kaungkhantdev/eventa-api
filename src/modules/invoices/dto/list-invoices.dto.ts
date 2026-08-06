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
import { invoiceStatusEnum } from '../../../db/schema';
import type { InvoiceStatus } from '../invoices.types';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
const MAX_SEARCH = 120;

/** Narrow the invoice ledger (US-FIN-06). */
export class ListInvoicesDto {
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

  @ApiPropertyOptional({ enum: invoiceStatusEnum.enumValues })
  @IsOptional()
  @IsIn(invoiceStatusEnum.enumValues)
  status?: InvoiceStatus;

  @ApiPropertyOptional({ description: 'Only invoices for this event.' })
  @IsOptional()
  @IsUUID()
  eventId?: string;

  @ApiPropertyOptional({ description: 'Invoice number or buyer name.' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SEARCH)
  search?: string;
}

/** One row of the invoice ledger. */
export class InvoiceEntryDto {
  @ApiProperty({ example: 12 })
  id!: number;

  @ApiProperty({ example: 'INV-2026-0001' })
  number!: string;

  @ApiProperty({ example: 'ORD-2026-0009' })
  orderReference!: string;

  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ example: 'Bangkok Tech Week' })
  eventName!: string;

  @ApiProperty({ example: 'Anan Suksawat' })
  buyerName!: string;

  @ApiProperty({ example: 'anan@example.com' })
  buyerEmail!: string;

  @ApiProperty({ example: '2026-06-01' })
  issuedAt!: string;

  @ApiProperty({ example: '2026-06-15' })
  dueAt!: string;

  @ApiProperty({
    example: 9,
    description: 'Days to the due date; negative once overdue (−3 = 3 late).',
  })
  daysUntilDue!: number;

  @ApiProperty({ example: 3_037_383 })
  subtotalSatang!: number;

  @ApiProperty({ example: 212_617 })
  vatAmountSatang!: number;

  @ApiProperty({ example: 3_250_000, description: 'VAT-inclusive.' })
  amountSatang!: number;

  @ApiProperty({ example: '฿32,500' })
  amountLabel!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ enum: invoiceStatusEnum.enumValues })
  status!: InvoiceStatus;

  @ApiProperty({ nullable: true, example: 'Card' })
  paidVia!: string | null;

  @ApiProperty({ nullable: true, example: '2026-06-03' })
  paidOn!: string | null;

  @ApiProperty({ description: 'Whether an Admin may void this invoice.' })
  canVoid!: boolean;

  @ApiProperty({ nullable: true })
  voidBlockedReason!: string | null;
}

/** The detail view — the ledger row plus what only one invoice shows. */
export class InvoiceDetailDto extends InvoiceEntryDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ nullable: true })
  voidReason!: string | null;
}

/** Live totals for the ledger tabs, across the whole filtered ledger. */
export class InvoiceCountsDto {
  @ApiProperty({ example: 4 })
  issued!: number;

  @ApiProperty({ example: 9 })
  paid!: number;

  @ApiProperty({ example: 2 })
  overdue!: number;

  @ApiProperty({ example: 1 })
  void!: number;
}
