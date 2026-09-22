import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  INSTANT_WITH_ZONE,
  INSTANT_WITH_ZONE_MESSAGE,
} from '../../announcements/announcement-schedule';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Body for "Email all attendees" (US-EVT-14). `confirm` makes the send explicit. */
export class EmailAttendeesDto {
  @ApiProperty({ minLength: 1, maxLength: 150, example: 'Doors open at 6pm' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  subject!: string;

  @ApiProperty({ minLength: 1, maxLength: 5000 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message!: string;

  @ApiProperty({
    description:
      'Must be true — the organizer’s explicit confirmation to send.',
    example: true,
  })
  @Equals(true)
  confirm!: boolean;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-08-05T03:00:00.000Z',
    description:
      'When to send it, as a UTC instant (US-MSG-04). Omit to send now. At least 5 minutes and at most a year ahead; the audience is resolved when it goes, not now.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(INSTANT_WITH_ZONE, { message: INSTANT_WITH_ZONE_MESSAGE })
  sendAt?: string;
}
