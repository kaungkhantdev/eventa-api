import { ApiProperty } from '@nestjs/swagger';

/** Result of accepting an "Email all attendees" broadcast for delivery. */
export class BroadcastResultDto {
  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({
    example: 42,
    description:
      'Confirmed attendees it will reach — for a scheduled send, those registered now; it is counted again when it goes',
  })
  recipients!: number;

  @ApiProperty({
    example: true,
    description:
      'Accepted and queued; the Engagement worker delivers it. False when it was scheduled — nothing is queued until its time comes.',
  })
  queued!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description:
      'When a scheduled send will go, UTC. Null when it was sent now (US-MSG-04).',
  })
  scheduledFor!: string | null;
}
