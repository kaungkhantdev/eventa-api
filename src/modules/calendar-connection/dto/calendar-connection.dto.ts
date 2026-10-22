import { ApiProperty } from '@nestjs/swagger';
import { calendarConnectionStatusEnum } from '../../../db/schema';
import type { CalendarConnectionStatus } from '../calendar-connection.types';

const STATUSES: CalendarConnectionStatus[] = [
  'not_configured',
  ...calendarConnectionStatusEnum.enumValues,
];

/**
 * The workspace Google Calendar connection (US-MTG-08). Carries no secret:
 * never the token, the pending state, who started it or who connected.
 */
export class CalendarConnectionDto {
  @ApiProperty({ enum: ['google'] })
  provider!: 'google';

  @ApiProperty({
    enum: STATUSES,
    description:
      'not_configured when this server has no Google client, whatever was stored; expired when Google stopped accepting the connection and an Admin must reconnect.',
  })
  status!: CalendarConnectionStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The Google account that granted access. Only for connected or expired, and only to callers with Manage integrations.',
  })
  accountEmail!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Set only while connected or expired.',
  })
  connectedAt!: string | null;
}

/** Where to send the Admin's browser to continue in Google. */
export class CalendarConnectStartDto {
  @ApiProperty({
    description:
      "Google's consent screen for this workspace. Single-use and valid for ten minutes.",
  })
  authorizeUrl!: string;
}
