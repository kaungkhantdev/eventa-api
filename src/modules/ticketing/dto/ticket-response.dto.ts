import { ApiProperty } from '@nestjs/swagger';
import { admissionTypeEnum, ticketStatusEnum } from '../../../db/schema';

/** A ticket tier with its VAT-inclusive price broken down (net + embedded VAT). */
export class TicketResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ example: 'VIP' })
  name!: string;

  @ApiProperty()
  isFree!: boolean;

  @ApiProperty({
    example: 89000,
    description: 'VAT-inclusive gross price (satang)',
  })
  priceSatang!: number;

  @ApiProperty({ example: 83178, description: 'Ex-VAT amount (satang)' })
  netSatang!: number;

  @ApiProperty({ example: 5822, description: 'Embedded VAT (satang)' })
  vatSatang!: number;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ enum: ticketStatusEnum.enumValues, example: 'scheduled' })
  status!: string;

  @ApiProperty({
    enum: admissionTypeEnum.enumValues,
    example: 'general_admission',
  })
  admissionType!: string;

  @ApiProperty({ example: 0, description: 'Sold count (derived, atomic)' })
  sold!: number;

  @ApiProperty({ example: 100, description: 'Allocation / quota' })
  total!: number;

  @ApiProperty({ example: 1 })
  minPerOrder!: number;

  @ApiProperty({ example: 8 })
  maxPerOrder!: number;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  salesStartAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  salesEndAt!: string | null;

  @ApiProperty({ example: 1, description: 'Optimistic-concurrency token' })
  version!: number;
}
