import { ApiProperty } from '@nestjs/swagger';

/** Result of accepting an "Email all attendees" broadcast for delivery. */
export class BroadcastResultDto {
  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({
    example: 42,
    description: 'Confirmed attendees it will reach',
  })
  recipients!: number;

  @ApiProperty({
    example: true,
    description: 'Accepted and queued; the Engagement worker delivers it',
  })
  queued!: boolean;
}
