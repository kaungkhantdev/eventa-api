import { ApiProperty } from '@nestjs/swagger';
import {
  Equals,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { BookingClaimTokenDto } from './booking-claim-token.dto';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_RULE_MESSAGE,
} from '../../../common/constants/auth-password.constants';

/**
 * Create the account from the emailed link (US-DISC-15): the link, a password
 * and the terms — nothing else. There is deliberately no email or name here:
 * the address comes from the verified link and the name from the order, so the
 * validation pipe refuses either if a client sends one.
 */
export class ClaimBookingAccountDto extends BookingClaimTokenDto {
  @ApiProperty({
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_RULE_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE_MESSAGE })
  password!: string;

  @ApiProperty({
    description: 'Must be true — the user accepts the Terms & Privacy.',
    example: true,
  })
  @Equals(true)
  acceptTerms!: boolean;
}
