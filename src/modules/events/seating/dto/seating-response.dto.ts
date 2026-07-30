import { ApiProperty } from '@nestjs/swagger';
import { seatingModeEnum } from '../../../../db/schema';

class SeatMapSummaryDto {
  @ApiProperty({ example: 'Grand Hall' })
  name!: string;

  @ApiProperty({ example: 10 })
  rows!: number;

  @ApiProperty({ example: 12 })
  seatsPerRow!: number;

  @ApiProperty({ example: 120, description: 'rows × seatsPerRow' })
  totalSeats!: number;
}

class SeatShortfallDto {
  @ApiProperty({ example: 120 })
  totalSeats!: number;

  @ApiProperty({ example: 200 })
  ticketQuantity!: number;
}

/** The event's seating configuration (GA headcount or a reserved seat map). */
export class SeatingResponseDto {
  @ApiProperty({ enum: seatingModeEnum.enumValues, example: 'reserved' })
  seatingMode!: string;

  @ApiProperty()
  isOnline!: boolean;

  @ApiProperty({ nullable: true, type: Number, description: 'GA headcount' })
  capacity!: number | null;

  @ApiProperty({ type: SeatMapSummaryDto, nullable: true })
  seatMap!: SeatMapSummaryDto | null;

  @ApiProperty({ example: 200, description: 'Sum of ticket-tier quantities' })
  ticketQuantity!: number;

  @ApiProperty({
    type: SeatShortfallDto,
    nullable: true,
    description:
      'Set when a reserved map holds fewer seats than ticket quantities',
  })
  seatShortfall!: SeatShortfallDto | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Guidance for online events (no seating)',
  })
  note!: string | null;
}
