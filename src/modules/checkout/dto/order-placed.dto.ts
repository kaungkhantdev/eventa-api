import { ApiProperty } from '@nestjs/swagger';
import {
  issuedTicketStatusEnum,
  orderStatusEnum,
  paymentStatusEnum,
} from '../../../db/schema';
import { OrderSummaryDto } from './order-summary.dto';

/** One issued admission. `qrToken` is the bearer credential the QR encodes. */
export class IssuedTicketDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    example: 'K7M2Q9XW4RT8V3NP6JHY5CBD',
    description: 'Scanned at the door; treat it as a credential',
  })
  qrToken!: string;

  @ApiProperty({ nullable: true, type: String })
  holderName!: string | null;

  @ApiProperty({ example: 'General Admission', nullable: true, type: String })
  ticketLabel!: string | null;

  @ApiProperty({ enum: issuedTicketStatusEnum.enumValues })
  status!: string;
}

/** The "You're registered!" recap (US-DISC-06). */
export class OrderPlacedDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({
    example: 'ORD-7K2M9QX4',
    description: 'Quote this to support',
  })
  reference!: string;

  @ApiProperty({ enum: orderStatusEnum.enumValues })
  status!: string;

  @ApiProperty({ enum: paymentStatusEnum.enumValues })
  paymentStatus!: string;

  @ApiProperty({ example: 'Bangkok Tech Week' })
  eventName!: string;

  @ApiProperty({ example: 'anan@example.com' })
  buyerEmail!: string;

  @ApiProperty({ example: 210_000 })
  totalSatang!: number;

  @ApiProperty({ example: 13_738 })
  vatSatang!: number;

  @ApiProperty({ type: OrderSummaryDto })
  summary!: OrderSummaryDto;

  @ApiProperty({
    type: [IssuedTicketDto],
    description: 'Empty until a paid order settles — no ticket before payment',
  })
  tickets!: IssuedTicketDto[];

  @ApiProperty({ description: 'True while the order still awaits payment' })
  paymentRequired!: boolean;
}
