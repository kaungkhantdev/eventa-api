import { ApiProperty } from '@nestjs/swagger';

/** A ticket type's shareable registration link and matching QR (US-TKT-06). */
export class TicketShareDto {
  @ApiProperty({ format: 'uuid' })
  ticketId!: string;

  @ApiProperty({ example: 'VIP pass' })
  ticketName!: string;

  @ApiProperty({
    example: 'https://eventa.app/e/bangkok-summit/register?ticket=…',
    description: 'Opens registration with this ticket type preselected',
  })
  registrationUrl!: string;

  @ApiProperty({ description: 'Inline SVG QR encoding registrationUrl' })
  qrSvg!: string;

  @ApiProperty({
    description: 'Exactly what the QR encodes — same as the link',
  })
  qrEncodes!: string;

  @ApiProperty({
    description: 'False while the event is draft, cancelled or private',
  })
  isPublished!: boolean;

  @ApiProperty({ nullable: true, type: String })
  warning!: string | null;
}
