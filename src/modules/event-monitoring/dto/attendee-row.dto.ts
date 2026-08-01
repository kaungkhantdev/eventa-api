import { ApiProperty } from '@nestjs/swagger';

/** One confirmed attendee on the Attendees tab (name/email gated behind regView). */
export class AttendeeRowDto {
  @ApiProperty({ example: 'Somchai Prasert' })
  name!: string;

  @ApiProperty({ example: 'somchai@example.com' })
  email!: string;

  @ApiProperty({
    example: 1,
    description: 'Confirmed registrations by this person',
  })
  registrations!: number;

  @ApiProperty({
    example: 2,
    description: 'Total seats across their registrations',
  })
  seats!: number;
}
