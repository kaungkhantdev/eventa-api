import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PASSWORD_MAX_LENGTH } from '../../auth-password/auth-password.policy';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@acme.test' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  /**
   * Verified, not policed.
   *
   * No strength rule here on purpose: the minimum for CHOOSING a password
   * lives in `auth-password.policy` and applies at sign-up, reset and change.
   * Repeating a stricter one at sign-in refused passwords this API had itself
   * issued — anything between the policy minimum and 8 characters could be
   * registered and then never used — and told the holder their input was
   * malformed rather than wrong, so nobody would think to reset it. It also
   * handed an unauthenticated caller the policy, and refused short passwords
   * before the credentials were read at all: a different status, body and
   * response time from a wrong one.
   *
   * The upper bound stays, as a resource guard rather than a rule: hashing is
   * deliberately slow, so an unbounded body is a way to spend CPU without an
   * account.
   */
  @ApiProperty({ example: 'correct horse battery staple' })
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  @ApiPropertyOptional({
    example: 'acme',
    description:
      'The organizer workspace. Required for organizer sign-in; refused for attendees, who have one platform-wide realm (US-DISC-08).',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  orgSlug?: string;

  @ApiPropertyOptional({ enum: ['admin', 'attendee'], default: 'admin' })
  @IsOptional()
  @IsIn(['admin', 'attendee'])
  persona?: 'admin' | 'attendee';

  @ApiPropertyOptional({
    description: 'Stay signed in on this device for longer (US-ACC-08).',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
