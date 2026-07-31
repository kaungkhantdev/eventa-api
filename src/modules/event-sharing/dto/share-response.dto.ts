import { ApiProperty } from '@nestjs/swagger';

class ShareChannelsDto {
  @ApiProperty() facebook!: string;
  @ApiProperty() x!: string;
  @ApiProperty() line!: string;
  @ApiProperty() whatsapp!: string;
  @ApiProperty({ description: 'mailto: link' }) email!: string;
}

/** Share metadata for promoting an event (US-EVT-15). */
export class ShareResponseDto {
  @ApiProperty({ example: 'https://app.eventa.co/e/tech-conf-2026' })
  publicUrl!: string;

  @ApiProperty({ description: 'Where to register (encode into the flyer QR)' })
  registrationUrl!: string;

  @ApiProperty({
    example: 'Join me at Tech Conf — 1 Sept 2026, 09:00 at Grand Hall',
  })
  shareMessage!: string;

  @ApiProperty({ type: ShareChannelsDto })
  channels!: ShareChannelsDto;

  @ApiProperty({ description: 'Whether the link is publicly reachable' })
  isPublic!: boolean;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Set when the event is not yet publicly reachable',
  })
  warning!: string | null;
}
