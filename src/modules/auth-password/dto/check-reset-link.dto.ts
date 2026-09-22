import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * Body for checking a reset link without spending it (US-ACC-04). In a body,
 * never a query string: a reset token must not sit in a URL the API logs.
 */
export class CheckResetLinkDto {
  @ApiProperty({ description: 'The token from the reset link.' })
  // Deliberately not `@IsJWT()`, unlike the reset itself. That turns a mangled
  // link into a 400 "Validation failed." — and this answer is what the reset
  // page shows the person holding the link. Whether the token is malformed,
  // forged, expired or used, the service refuses it with the same 422 and the
  // same words: to them it is the same dead link.
  @IsString()
  token!: string;
}
