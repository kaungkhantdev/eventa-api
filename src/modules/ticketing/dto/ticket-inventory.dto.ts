import { ApiProperty } from '@nestjs/swagger';
import { ticketStatusEnum } from '../../../db/schema';

/** A tier as it appears in the cross-event inventory list (US-TKT-04). */
export class TicketInventoryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ example: 'Bangkok Jazz Festival' })
  eventName!: string;

  @ApiProperty({ example: 'General admission' })
  name!: string;

  @ApiProperty()
  isFree!: boolean;

  @ApiProperty({
    example: 89000,
    description: 'VAT-inclusive gross price (satang); 0 when free',
  })
  priceSatang!: number;

  @ApiProperty({ example: 0.07, description: "The org's VAT rate" })
  vatRate!: number;

  @ApiProperty({ enum: ticketStatusEnum.enumValues, example: 'onsale' })
  status!: string;

  @ApiProperty({ example: 42, description: 'Sold (read-only here)' })
  sold!: number;

  @ApiProperty({ example: 100, description: 'Allocation; 0 = unlimited' })
  total!: number;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  salesStartAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  salesEndAt!: string | null;
}
