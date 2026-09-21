import { ApiProperty } from '@nestjs/swagger';

/** One broadcast an organizer has already sent (US-MSG-04). */
export class AnnouncementDto {
  @ApiProperty({ example: '42' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Tech Summit 2026',
    description:
      'Null when the event has since been deleted. The send still happened, so the record stays.',
  })
  eventName!: string | null;

  @ApiProperty({ example: 'Venue change notice' })
  subject!: string;

  @ApiProperty({ description: 'The message as it was sent.' })
  body!: string;

  @ApiProperty({
    example: 1340,
    description:
      'Attendees at the moment it was queued — what the organizer was told they were writing to, NOT a delivery receipt. Proving delivery is US-MSG-06.',
  })
  recipientCount!: number;

  @ApiProperty({ format: 'date-time', description: 'When it was sent, UTC.' })
  sentAt!: string;
}
