import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

const MAX_LIMIT = 100;

/** Paging for the transaction list (US-DISC-10). */
export class ListTransactionsDto {
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
}

/** The three summary tiles (US-DISC-10). Refunds never count as spend. */
export class PaymentSummaryDto {
  @ApiProperty({ example: 210_000 })
  totalSpentSatang!: number;

  @ApiProperty({ example: '฿2,100' })
  totalSpentLabel!: string;

  @ApiProperty({ example: 50_000 })
  totalRefundedSatang!: number;

  @ApiProperty({ example: '฿500' })
  totalRefundedLabel!: string;

  @ApiProperty({ example: 2 })
  transactionCount!: number;
}

/** One row of the payment history. */
export class TransactionDto {
  @ApiProperty({ format: 'uuid' })
  paymentId!: string;

  @ApiProperty({
    example: 'ORD-7K2M9QX4',
    description: 'The invoice number shown on the receipt',
  })
  reference!: string;

  @ApiProperty({ example: 'Bangkok Tech Week' })
  eventName!: string;

  @ApiProperty({
    example: 'Card',
    description:
      'Payment method by name. Card digits are never stored (PCI SAQ-A), so there is no masked number to show.',
  })
  method!: string;

  @ApiProperty({
    enum: ['paid', 'refunded'],
    description: 'Refunded rows are struck through and excluded from spend',
  })
  status!: string;

  @ApiProperty({ example: 210_000 })
  amountSatang!: number;

  @ApiProperty({ example: '฿2,100' })
  amountLabel!: string;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  paidAt!: string | null;
}
