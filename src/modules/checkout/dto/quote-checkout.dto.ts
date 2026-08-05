import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_SEATS_PER_BOOKING } from '../../../common/booking/booking.limits';

const MAX_CODE = 24;
const MAX_EMAIL = 254;

/**
 * A checkout selection. Exactly one ticket type, then EITHER a quantity (general
 * admission) or seat ids (reserved seating) — which one applies is decided by the
 * event, not by this payload, so sending the wrong shape is refused rather than
 * reinterpreted.
 *
 * Note what is absent: no price, no subtotal, no total. Amounts are read from the
 * ticket type and the workspace at the moment of pricing; nothing a client sends
 * can influence what an order costs.
 */
export class QuoteCheckoutDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  eventId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  ticketTypeId!: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_SEATS_PER_BOOKING,
    description: 'General admission and online events',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_SEATS_PER_BOOKING)
  quantity?: number;

  @ApiPropertyOptional({
    type: [Number],
    maxItems: MAX_SEATS_PER_BOOKING,
    description: 'Reserved seating only',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SEATS_PER_BOOKING)
  @Type(() => Number)
  @IsInt({ each: true })
  seatIds?: number[];

  @ApiPropertyOptional({ example: 'PROMO42' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CODE)
  discountCode?: string;

  @ApiPropertyOptional({
    example: 'anan@example.com',
    description:
      'Lets a per-person code limit be checked before the order exists',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(MAX_EMAIL)
  buyerEmail?: string;
}

/** Reserve the selection while the buyer pays. Same shape, minus the pricing bits. */
export class HoldCheckoutDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  eventId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  ticketTypeId!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_SEATS_PER_BOOKING })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_SEATS_PER_BOOKING)
  quantity?: number;

  @ApiPropertyOptional({ type: [Number], maxItems: MAX_SEATS_PER_BOOKING })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SEATS_PER_BOOKING)
  @Type(() => Number)
  @IsInt({ each: true })
  seatIds?: number[];
}

/** Give held inventory back when the buyer walks away. */
export class ReleaseCheckoutDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  eventId!: string;

  @ApiProperty({ type: [Number], maxItems: MAX_SEATS_PER_BOOKING })
  @IsArray()
  @ArrayMaxSize(MAX_SEATS_PER_BOOKING)
  @Type(() => Number)
  @IsInt({ each: true })
  holdIds!: number[];
}
