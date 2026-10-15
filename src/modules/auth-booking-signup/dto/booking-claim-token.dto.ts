import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

/**
 * Far longer than any token this API signs, short enough that nobody can make
 * the verifier chew on a megabyte.
 */
const CLAIM_TOKEN_MAX_LENGTH = 2048;

/**
 * The emailed claim link's token (US-DISC-15), always in the request BODY so
 * it never lands in a URL — and so in no access log.
 *
 * Deliberately not `@IsJWT`: a mangled link is the same event as an expired
 * one to the person holding it, and the service answers both with the one
 * sentence the page shows, rather than the validator's "Validation failed.".
 */
export class BookingClaimTokenDto {
  @ApiProperty({ description: 'The token from the emailed claim link.' })
  @IsString()
  @MaxLength(CLAIM_TOKEN_MAX_LENGTH)
  token!: string;
}
