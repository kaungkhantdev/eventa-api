import { ApiProperty } from '@nestjs/swagger';
import { seatingModeEnum, ticketStatusEnum } from '../../../db/schema';

/** The event, as the checkout header shows it. */
export class CheckoutEventDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'bangkok-tech-week' })
  slug!: string;

  @ApiProperty({ example: 'Bangkok Tech Week' })
  name!: string;

  @ApiProperty({
    format: 'date-time',
    description: 'UTC; render in `timezone`',
  })
  startAt!: string;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  endAt!: string | null;

  @ApiProperty({ example: 'Asia/Bangkok' })
  timezone!: string;

  @ApiProperty()
  isOnline!: boolean;

  @ApiProperty({ nullable: true, type: String })
  venueName!: string | null;

  @ApiProperty({ nullable: true, type: String })
  venueAddress!: string | null;

  @ApiProperty({ nullable: true, type: String })
  city!: string | null;

  @ApiProperty({ nullable: true, type: String })
  coverImage!: string | null;

  @ApiProperty({ example: 'Acme Events' })
  organizerName!: string;

  @ApiProperty({ enum: seatingModeEnum.enumValues })
  seatingMode!: string;
}

/** One ticket type a buyer may choose (exactly one per order). */
export class CheckoutTierDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'General Admission' })
  name!: string;

  @ApiProperty({ example: '฿1,200', description: "'Free' for a free tier" })
  priceLabel!: string;

  @ApiProperty({
    example: 120_000,
    description: 'VAT-inclusive integer satang',
  })
  priceSatang!: number;

  @ApiProperty()
  isFree!: boolean;

  @ApiProperty({ enum: ticketStatusEnum.enumValues })
  status!: string;

  @ApiProperty({ description: 'False for paused, scheduled or sold-out tiers' })
  canSelect!: boolean;

  @ApiProperty({ example: 1 })
  minPerOrder!: number;

  @ApiProperty({ example: 8 })
  maxPerOrder!: number;

  @ApiProperty({
    example: 42,
    nullable: true,
    type: Number,
    description: 'Null when the allocation is unlimited',
  })
  remaining!: number | null;
}

/** One seat on a reserved-seating map. Taken seats are drawn, not hidden. */
export class CheckoutSeatDto {
  @ApiProperty({ example: 1234 })
  id!: number;

  @ApiProperty({ nullable: true, type: String })
  section!: string | null;

  @ApiProperty({ nullable: true, type: String })
  rowLabel!: string | null;

  @ApiProperty({ example: '12' })
  seatNumber!: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  ticketTypeId!: string | null;

  @ApiProperty({ description: 'False when sold, blocked, or held right now' })
  available!: boolean;
}

export class CheckoutSeatMapDto {
  @ApiProperty({ type: [CheckoutSeatDto] })
  seats!: CheckoutSeatDto[];
}

/** The plain-language notes the checkout shows about seating and delivery. */
export class CheckoutNotesDto {
  @ApiProperty({
    nullable: true,
    type: String,
    example: 'Seating is first-come, first-served.',
  })
  seating!: string | null;

  @ApiProperty({ nullable: true, type: String })
  delivery!: string | null;
}

/** Everything the checkout page needs before the buyer picks anything. */
export class CheckoutViewDto {
  @ApiProperty({ type: CheckoutEventDto })
  event!: CheckoutEventDto;

  @ApiProperty({ type: [CheckoutTierDto] })
  tiers!: CheckoutTierDto[];

  @ApiProperty({
    type: CheckoutSeatMapDto,
    nullable: true,
    description: 'Only for a reserved-seating event',
  })
  seatMap!: CheckoutSeatMapDto | null;

  @ApiProperty({ type: CheckoutNotesDto })
  notes!: CheckoutNotesDto;

  @ApiProperty({ example: 8 })
  maxPerBooking!: number;

  @ApiProperty({ description: 'False when every selectable tier is free' })
  paymentRequired!: boolean;
}
