import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Ask to use a new phone number (US-DISC-11 AC3).
 *
 * Validated loosely here on purpose: the number is accepted in the forms a
 * Thai form actually collects (`0812345678`, `+66812345678`, with spaces or
 * dashes) and `toThaiMobileE164` in the service decides whether it is a mobile
 * Eventa can text. A regex here would either have to repeat that rule or
 * refuse a number the member typed perfectly correctly, and the refusal the
 * service gives names the problem — "that isn't a Thai mobile" — rather than
 * quoting a pattern.
 */
export class ChangePhoneDto {
  @ApiProperty({
    example: '0812345678',
    description:
      'A Thai mobile, in any form a person types it. Normalised to E.164.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  phone!: string;
}
