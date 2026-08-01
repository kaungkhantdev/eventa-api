import { ApiProperty } from '@nestjs/swagger';
import { EventResponseDto } from './event-response.dto';

/**
 * An event as it appears in the organizer's list (US-EVT-01): the full event plus
 * its registrations-vs-capacity fill. `registrations` is the tickets sold across
 * the event's tiers (the Ticketing context is the source of truth); `fillPercent`
 * is that count over the effective capacity (event capacity, else Σ ticket quantity).
 */
export class EventListItemDto extends EventResponseDto {
  @ApiProperty({
    example: 45,
    description: 'Tickets sold (registrations so far)',
  })
  registrations!: number;

  @ApiProperty({ example: 45, description: 'registrations ÷ capacity, 0–100' })
  fillPercent!: number;
}
