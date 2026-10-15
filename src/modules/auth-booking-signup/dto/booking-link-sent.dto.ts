import { ApiProperty } from '@nestjs/swagger';

/** Where the create-your-account link went (US-DISC-15). */
export class BookingLinkSentDto {
  @ApiProperty({
    description:
      'The booking’s own email — the only address the link is ever sent to',
    example: 'anan@example.com',
  })
  sentTo!: string;
}
