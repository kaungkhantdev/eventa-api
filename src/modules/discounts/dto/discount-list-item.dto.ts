import { ApiProperty } from '@nestjs/swagger';
import { discountStatusEnum, discountTypeEnum } from '../../../db/schema';

/** A row in the promotions table (US-TKT-12). */
export class DiscountListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'PROMO42' })
  code!: string;

  @ApiProperty({ enum: discountTypeEnum.enumValues })
  type!: string;

  @ApiProperty({ example: 25 })
  value!: number;

  @ApiProperty({ enum: discountStatusEnum.enumValues })
  status!: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  eventId!: string | null;

  @ApiProperty({
    example: 'All events',
    description: "The event's name, or 'All events' for a workspace-wide code",
  })
  scopeLabel!: string;

  @ApiProperty({ example: 89, description: 'Redemptions used (live)' })
  used!: number;

  @ApiProperty({ example: 500, description: '0 = unlimited' })
  redemptionLimit!: number;

  @ApiProperty({ example: 0 })
  minOrderSatang!: number;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  validFrom!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  validUntil!: string | null;
}
