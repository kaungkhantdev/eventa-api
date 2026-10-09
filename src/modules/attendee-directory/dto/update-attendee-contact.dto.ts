import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';

// The same limits the walk-up booking form uses (`AddRegistrationDto`), which
// are the ones `attendees` is documented with: a name is 1–120 characters.
const MAX_NAME = 120;
const MAX_EMAIL = 254;
const MAX_PHONE = 24;

/**
 * Correct an attendee's contact details (US-REG-08). A PATCH: send only the
 * fields that are changing.
 *
 * An invalid name or email is refused HERE, before any rule runs, so the
 * organizer gets inline field errors and nothing is applied (AC4). The phone is
 * only length-checked, as it is on every other form in this API — attendees
 * give Thai mobiles, landlines and foreign numbers, and the messaging path
 * decides for itself what it can text (`toThaiMobileE164`), so a stricter
 * pattern here would refuse numbers that are perfectly good to store.
 */
export class UpdateAttendeeContactDto {
  @ApiPropertyOptional({ example: 'Anan Suksawat', maxLength: MAX_NAME })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME)
  name?: string;

  @ApiPropertyOptional({ example: 'anan@example.com', maxLength: MAX_EMAIL })
  @IsOptional()
  @IsEmail()
  @MaxLength(MAX_EMAIL)
  email?: string;

  @ApiPropertyOptional({
    example: '+66812345678',
    maxLength: MAX_PHONE,
    description: 'Send an empty string to clear it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_PHONE)
  phone?: string;

  @ApiPropertyOptional({
    minimum: 1,
    description:
      'The version the profile was opened on. Sent back, a newer row is ' +
      'refused with 409 rather than overwritten.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}
