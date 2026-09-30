import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MAX_SEATS_PER_BOOKING } from '../../../common/booking/booking.limits';
import { BuyerDto } from './confirm-order.dto';

const MIN_IDEMPOTENCY_KEY = 8;
const MAX_IDEMPOTENCY_KEY = 128;

/**
 * Join a sold-out ticket's waitlist (US-REG-04). Carries no amounts: the entry
 * is priced by the catalog when it joins, like any order.
 */
export class JoinWaitlistDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  eventId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  ticketTypeId!: string;

  @ApiProperty({ minimum: 1, maximum: MAX_SEATS_PER_BOOKING })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_SEATS_PER_BOOKING)
  quantity!: number;

  @ApiProperty({ type: BuyerDto })
  @ValidateNested()
  @Type(() => BuyerDto)
  buyer!: BuyerDto;

  @ApiProperty({
    minLength: MIN_IDEMPOTENCY_KEY,
    description:
      'The client’s key for this attempt. Re-sending it returns the same place in line.',
  })
  @IsString()
  @MinLength(MIN_IDEMPOTENCY_KEY)
  @MaxLength(MAX_IDEMPOTENCY_KEY)
  idempotencyKey!: string;
}

/** Where the buyer now stands. */
export class WaitlistJoinedDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ example: 'ORD-7K2M9QX4' })
  reference!: string;

  @ApiProperty({ example: 'Bangkok Tech Week' })
  eventName!: string;

  @ApiProperty({ example: 'General Admission' })
  ticketTypeName!: string;

  @ApiProperty({ example: 2 })
  quantity!: number;

  @ApiProperty({
    example: 3,
    description: 'Place in line for this ticket; 1 is next.',
  })
  position!: number;
}
