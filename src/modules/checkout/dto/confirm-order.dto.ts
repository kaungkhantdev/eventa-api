import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MAX_SEATS_PER_BOOKING } from '../../../common/booking/booking.limits';

const MAX_NAME = 120;
const MAX_EMAIL = 254;
const MAX_PHONE = 24;
const MAX_CODE = 24;
const MIN_IDEMPOTENCY_KEY = 8;
const MAX_IDEMPOTENCY_KEY = 128;

/**
 * Who is registering. A guest gives these directly; a signed-in attendee gets
 * them pre-filled and may edit them for this order. Either way the order is the
 * record — confirming as a guest creates no account (US-DISC-04).
 */
export class BuyerDto {
  @ApiProperty({ example: 'Anan Suksawat' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME)
  name!: string;

  @ApiProperty({ example: 'anan@example.com' })
  @IsEmail()
  @MaxLength(MAX_EMAIL)
  email!: string;

  @ApiPropertyOptional({
    example: '+66812345678',
    description: 'Needed for PromptPay, and gates the confirmation SMS',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_PHONE)
  phone?: string;
}

/** Place the registration (US-DISC-06). Carries no amounts — see `QuoteCheckoutDto`. */
export class ConfirmOrderDto {
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

  @ApiProperty({
    type: [Number],
    maxItems: MAX_SEATS_PER_BOOKING,
    description: 'From the hold that reserved this selection',
  })
  @IsArray()
  @ArrayMaxSize(MAX_SEATS_PER_BOOKING)
  @Type(() => Number)
  @IsInt({ each: true })
  holdIds!: number[];

  @ApiPropertyOptional({ example: 'PROMO42' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CODE)
  discountCode?: string;

  @ApiProperty({ type: BuyerDto })
  @ValidateNested()
  @Type(() => BuyerDto)
  buyer!: BuyerDto;

  @ApiProperty({
    example: '5f1c3a9e-2b7d-4c8f-9a11-6d0e2f4b8c31',
    minLength: MIN_IDEMPOTENCY_KEY,
    description:
      'The client’s key for this attempt. Re-sending it returns the same order rather than placing a second one.',
  })
  @IsString()
  @MinLength(MIN_IDEMPOTENCY_KEY)
  @MaxLength(MAX_IDEMPOTENCY_KEY)
  idempotencyKey!: string;
}
