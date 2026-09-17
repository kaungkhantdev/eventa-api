import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_RULE_MESSAGE,
} from '../../auth-password/auth-password.policy';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Body for sign-up. An organizer gets a workspace + its owner (US-ACC-01); an
 * attendee gets one account in the platform organization (US-DISC-08).
 */
export class RegisterDto {
  @ApiProperty({ example: 'Somchai Prasert' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'owner@acme.co.th' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_RULE_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE_MESSAGE })
  password!: string;

  @ApiPropertyOptional({
    description:
      'Workspace name; defaults to "<name>’s Workspace". Organizer only — refused for an attendee, who owns no workspace.',
    example: 'Acme Events',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  organizationName?: string;

  @ApiPropertyOptional({
    enum: ['admin', 'attendee'],
    default: 'admin',
    description:
      'Which realm to create the account in. Defaults to organizer, as it always did (US-DISC-08).',
  })
  @IsOptional()
  @IsIn(['admin', 'attendee'])
  persona?: 'admin' | 'attendee';

  @ApiProperty({
    description: 'Must be true — the user accepts the Terms & Privacy.',
    example: true,
  })
  @Equals(true)
  acceptTerms!: boolean;
}
