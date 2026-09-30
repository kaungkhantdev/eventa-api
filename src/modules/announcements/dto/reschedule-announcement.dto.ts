import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, Matches } from 'class-validator';
import {
  INSTANT_WITH_ZONE,
  INSTANT_WITH_ZONE_MESSAGE,
} from '../announcement-schedule';

/** Move a scheduled announcement to a new time (US-MSG-05). */
export class RescheduleAnnouncementDto {
  @ApiProperty({
    format: 'date-time',
    example: '2026-08-06T08:00:00.000Z',
    description:
      'The new send time, as a UTC instant. At least 5 minutes and at most a year ahead.',
  })
  @IsISO8601({ strict: true })
  @Matches(INSTANT_WITH_ZONE, { message: INSTANT_WITH_ZONE_MESSAGE })
  sendAt!: string;
}
