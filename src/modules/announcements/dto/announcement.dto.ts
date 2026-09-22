import { ApiProperty } from '@nestjs/swagger';
import { announcementStatusEnum } from '../../../db/schema';

/** One broadcast in the history — sent, still to go, or called off (US-MSG-04/05). */
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

  @ApiProperty({ description: 'The message as it was (or will be) sent.' })
  body!: string;

  @ApiProperty({
    enum: announcementStatusEnum.enumValues,
    example: 'sent',
    description:
      '`scheduled` waits for `scheduledFor` and is the only state that can still be cancelled or moved; `cancelled` never goes and stays in the history.',
  })
  status!: (typeof announcementStatusEnum.enumValues)[number];

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When a scheduled one is (or was) due, UTC. Null for one sent straight away.',
  })
  scheduledFor!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When it went, UTC. Null until then, and for a cancelled one.',
  })
  sentAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When it was cancelled, UTC.',
  })
  cancelledAt!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 1340,
    description:
      'Attendees at the moment it was queued — what the organizer was told they were writing to, NOT a delivery receipt. Proving delivery is US-MSG-06. Null until it has gone: a scheduled one is counted when it is sent, and null is not "nobody".',
  })
  recipientCount!: number | null;
}
