import { ApiProperty } from '@nestjs/swagger';

/** The same numbers, formatted the way the summary reads them. */
export class OrderSummaryLabelsDto {
  @ApiProperty({ example: '฿2,000' })
  subtotal!: string;

  @ApiProperty({ example: '฿500', nullable: true, type: String })
  discount!: string | null;

  @ApiProperty({ example: '฿100' })
  serviceFee!: string;

  @ApiProperty({ example: '฿2,100' })
  total!: string;
}

/**
 * The live order summary (US-DISC-04) and, once confirmed, exactly what is
 * written to `orders`. Every amount is integer satang; `subtotal - discount +
 * serviceFee === total` and `net + vat === total`, always.
 */
export class OrderSummaryDto {
  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ format: 'uuid' })
  ticketTypeId!: string;

  @ApiProperty({ example: 'General Admission' })
  ticketTypeName!: string;

  @ApiProperty({
    example: 2,
    description: 'Admissions — one per seat, or the GA quantity',
  })
  quantity!: number;

  @ApiProperty({
    type: [Number],
    nullable: true,
    description: 'Only for reserved seating',
  })
  seatIds!: number[] | null;

  @ApiProperty({ example: 100_000 })
  unitPriceSatang!: number;

  @ApiProperty({ example: 200_000 })
  subtotalSatang!: number;

  @ApiProperty({ example: 50_000 })
  discountSatang!: number;

  @ApiProperty({ example: 10_000 })
  serviceFeeSatang!: number;

  @ApiProperty({
    example: 210_000,
    description: 'What the attendee pays, VAT included',
  })
  totalSatang!: number;

  @ApiProperty({ example: 196_262, description: 'Ex-VAT part of the total' })
  netSatang!: number;

  @ApiProperty({ example: 13_738, description: 'VAT embedded in the total' })
  vatSatang!: number;

  @ApiProperty({
    example: 'PROMO42',
    nullable: true,
    type: String,
    description: 'The code as applied, normalised',
  })
  discountCode!: string | null;

  @ApiProperty({ type: OrderSummaryLabelsDto })
  labels!: OrderSummaryLabelsDto;

  @ApiProperty({
    description: 'False for a free order — the payment step is skipped',
  })
  paymentRequired!: boolean;
}

/** What a successful reservation gives the buyer: a handle and a deadline. */
export class CheckoutHoldDto {
  @ApiProperty({ type: [Number], example: [21, 22] })
  holdIds!: number[];

  @ApiProperty({
    format: 'date-time',
    description: 'The inventory is yours until then',
  })
  expiresAt!: string;
}
