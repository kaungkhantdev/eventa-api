import { ApiProperty } from '@nestjs/swagger';
import { IsJWT } from 'class-validator';

/** Body for confirming a new account's email (US-ACC-01). */
export class VerifyEmailDto {
  @ApiProperty({ description: 'The token from the confirmation link.' })
  @IsJWT()
  token!: string;
}
