import { ApiProperty } from '@nestjs/swagger';
import { IsJWT } from 'class-validator';

/** Body for confirming a new account's email (US-ACC-01). */
export class VerifyEmailDto {
  @ApiProperty({ description: 'The token from the confirmation link.' })
  // The message matters: this fires on a truncated or mangled link — a real
  // thing that happens when an email client wraps a long URL — and whatever it
  // says is shown to the person holding that link. The default ("token must be
  // a jwt string") describes our encoding, not their problem. Kept identical to
  // the service's wording for an expired token, because from where they are
  // standing the two are the same event.
  @IsJWT({
    message:
      'This confirmation link is invalid or has expired. Request a new one.',
  })
  token!: string;
}
