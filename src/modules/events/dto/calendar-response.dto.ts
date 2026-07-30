import { ApiProperty } from '@nestjs/swagger';
import { EventResponseDto } from './event-response.dto';

/** A month of the organizer's events for the calendar view (US-EVT-12). */
export class CalendarResponseDto {
  @ApiProperty({ example: '2026-09', description: 'YYYY-MM (Asia/Bangkok)' })
  month!: string;

  @ApiProperty({ example: 4, description: 'Events this month' })
  count!: number;

  @ApiProperty({ type: [EventResponseDto] })
  events!: EventResponseDto[];
}
