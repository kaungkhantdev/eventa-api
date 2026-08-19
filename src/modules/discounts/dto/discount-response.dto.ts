import { ApiProperty } from '@nestjs/swagger';
import { discountStatusEnum, discountTypeEnum } from '../../../db/schema';

/** A discount code with its live redemption count and derived status. */
export class DiscountResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'PROMO42' })
  code!: string;

  @ApiProperty({ enum: discountTypeEnum.enumValues, example: 'percent' })
  type!: string;

  @ApiProperty({
    example: 25,
    description: 'Percent 1–100, or a fixed amount in satang',
  })
  value!: number;

  @ApiProperty({ enum: discountStatusEnum.enumValues, example: 'active' })
  status!: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  eventId!: string | null;

  @ApiProperty({ enum: ['event', 'all_events'], example: 'all_events' })
  scope!: string;

  @ApiProperty({ example: 0, description: 'Redemptions made (read-only)' })
  used!: number;

  @ApiProperty({ example: 500, description: '0 = unlimited' })
  redemptionLimit!: number;

  @ApiProperty({ example: 1, description: '0 = unlimited per buyer' })
  perPersonLimit!: number;

  @ApiProperty({ example: 0, description: 'Minimum order (satang); 0 = none' })
  minOrderSatang!: number;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  validFrom!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  validUntil!: string | null;

  @ApiProperty({ example: 1, description: 'Optimistic-concurrency token' })
  version!: number;
}
