import { ApiProperty } from '@nestjs/swagger';
import { orderStatusEnum, paymentStatusEnum } from '../../../db/schema';
import { IssuedTicketDto } from './order-placed.dto';

/** One line of what was bought — the tier, and what it cost at the time. */
export class GuestOrderLineDto {
  @ApiProperty({ example: 'General Admission' })
  ticketTypeName!: string;

  @ApiProperty({ example: 2 })
  quantity!: number;

  @ApiProperty({ example: 150_000 })
  unitPriceSatang!: number;

  @ApiProperty({ example: 300_000 })
  lineSubtotalSatang!: number;
}

/**
 * The buyer's own copy of their order (US-DISC-06/07).
 *
 * Deliberately NOT `OrderPlacedDto`. That one carries the full priced
 * `summary`, which is built while quoting — service fees, labels, the applied
 * code — and is not stored on the order. Re-deriving it here would mean
 * inventing figures the buyer never saw. This carries what the order actually
 * recorded, and nothing else.
 */
export class GuestOrderDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ example: 'ORD-7K2M9QX4' })
  reference!: string;

  @ApiProperty({ enum: orderStatusEnum.enumValues })
  status!: string;

  @ApiProperty({ enum: paymentStatusEnum.enumValues })
  paymentStatus!: string;

  @ApiProperty({ example: 'Bangkok Tech Week' })
  eventName!: string;

  @ApiProperty({ example: 'anan@example.com' })
  buyerEmail!: string;

  @ApiProperty({ example: 'Anan Suksawat' })
  buyerName!: string;

  @ApiProperty({
    example: 315_000,
    description: 'What was charged, VAT included',
  })
  totalSatang!: number;

  @ApiProperty({ example: 20_607, description: 'VAT embedded in the total' })
  vatSatang!: number;

  @ApiProperty({ example: 300_000 })
  subtotalSatang!: number;

  @ApiProperty({ example: 0 })
  discountSatang!: number;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ type: [GuestOrderLineDto] })
  lines!: GuestOrderLineDto[];

  @ApiProperty({
    type: [IssuedTicketDto],
    description: 'Empty until a paid order settles — no ticket before payment',
  })
  tickets!: IssuedTicketDto[];

  @ApiProperty({ description: 'True while the order still awaits payment' })
  paymentRequired!: boolean;

  @ApiProperty({ format: 'date-time' })
  placedAt!: string;
}
