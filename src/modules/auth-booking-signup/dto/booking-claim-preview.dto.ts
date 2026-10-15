import { ApiProperty } from '@nestjs/swagger';

/**
 * What a good claim link creates (US-DISC-15): shown read-only above the
 * password field, so the person sees whose account it is before choosing one.
 */
export class BookingClaimPreviewDto {
  @ApiProperty({
    description: 'The buyer’s name, from the booking',
    example: 'Anan Suksawat',
  })
  name!: string;

  @ApiProperty({
    description: 'The address the link was sent to — the account’s email',
    example: 'anan@example.com',
  })
  email!: string;

  @ApiProperty({
    description:
      'True when an attendee account already uses this email — sign in instead',
  })
  accountExists!: boolean;
}
