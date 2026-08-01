import { ApiProperty } from '@nestjs/swagger';
import { eventStatusEnum, eventTypeEnum } from '../../../db/schema';

/** A future event in the soonest-first "upcoming" view (US-EVT-12). */
export class UpcomingEventDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty({ enum: eventTypeEnum.enumValues })
  type!: string;

  @ApiProperty({ enum: eventStatusEnum.enumValues })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  startAt!: string;

  @ApiProperty({
    example: 12,
    description: 'Whole days until start (Bangkok time)',
  })
  daysLeft!: number;

  @ApiProperty({
    example: 40,
    description: 'Tickets sold (registrations proxy)',
  })
  sold!: number;

  @ApiProperty({
    example: 200,
    description: 'Capacity (headcount, else total ticket quantity)',
  })
  capacity!: number;

  @ApiProperty({ example: 20, description: 'sold ÷ capacity, 0–100' })
  fillPercent!: number;
}
