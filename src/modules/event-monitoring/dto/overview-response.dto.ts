import { ApiProperty } from '@nestjs/swagger';

/** Event-workspace Overview headline numbers (US-EVT-14). Money is integer satang. */
export class OverviewResponseDto {
  @ApiProperty({ example: 45, description: 'Confirmed admissions booked' })
  registrations!: number;

  @ApiProperty({ example: 45, description: 'Live issued tickets' })
  ticketsSold!: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Configured capacity',
  })
  capacity!: number | null;

  @ApiProperty({ example: 45, description: 'registrations ÷ capacity, 0–100' })
  fillPercent!: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      'Captured revenue in satang; null when the caller lacks finView',
  })
  revenueSatang!: number | null;

  @ApiProperty({
    example: 31,
    description: 'Whole Bangkok days until the event',
  })
  daysLeft!: number;

  @ApiProperty({ description: "The event's public link (the Copy button)" })
  publicUrl!: string;
}
