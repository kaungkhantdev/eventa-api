import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
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

/** Accept a workspace invite by setting a password. */
export class AcceptInviteDto {
  @ApiProperty({ description: 'The invite token from POST /members' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  /**
   * Chosen here, so the shared policy applies — the same rule sign-up, reset
   * and change enforce. It used to carry its own hard-coded 8, which quietly
   * made accepting an invite stricter than every other way of setting one.
   */
  @ApiProperty({
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    example: 'a strong new password',
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_RULE_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE_MESSAGE })
  password!: string;
}

/** Result of accepting an invite — the member can now sign in. */
export class AcceptInviteResponseDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ example: 'sam@acme.test' })
  email!: string;

  @ApiProperty({ example: 'Active' })
  status!: string;
}
