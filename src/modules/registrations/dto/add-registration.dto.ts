import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_SEATS_PER_BOOKING } from '../../../common/booking/booking.limits';

const MAX_NAME = 120;
const MAX_EMAIL = 254;
const MAX_PHONE = 24;

/**
 * A walk-up or phone booking the organizer is entering (US-REG-03). Carries NO
 * amount: the total is computed from the tier and the workspace's VAT rate at
 * the moment of saving, so an organizer cannot mistype a price or bill the wrong
 * VAT — see `RegistrationEntryPort`.
 */
export class AddRegistrationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  eventId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  ticketTypeId!: string;

  @ApiProperty({ minimum: 1, maximum: MAX_SEATS_PER_BOOKING, example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_SEATS_PER_BOOKING)
  quantity!: number;

  @ApiProperty({ example: 'Anan Suksawat' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME)
  name!: string;

  @ApiProperty({ example: 'anan@example.com' })
  @IsEmail()
  @MaxLength(MAX_EMAIL)
  email!: string;

  @ApiPropertyOptional({ example: '+66812345678' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_PHONE)
  phone?: string;

  @ApiPropertyOptional({
    default: true,
    description:
      'Off creates the ticket quietly for the organizer to deliver later.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  sendConfirmation?: boolean;
}

export class AddedRegistrationDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ example: 'ORD-2026-0009' })
  reference!: string;

  @ApiProperty({ example: 'confirmed' })
  status!: string;

  @ApiProperty({ example: 'paid' })
  paymentStatus!: string;

  @ApiProperty({ description: 'Integer satang, VAT-inclusive.' })
  totalSatang!: number;

  @ApiProperty({ description: 'Integer satang.' })
  vatSatang!: number;

  @ApiProperty({
    example: 'Free',
    description: '"Free", or the total formatted in baht.',
  })
  amountLabel!: string;

  @ApiProperty({ description: 'Tickets issued now; 0 while payment is due.' })
  ticketCount!: number;

  @ApiProperty({ description: 'True when the booking still awaits payment.' })
  paymentRequired!: boolean;
}
