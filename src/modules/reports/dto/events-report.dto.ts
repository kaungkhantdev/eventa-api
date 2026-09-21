import { ApiProperty } from '@nestjs/swagger';
import {
  EVENT_LIFECYCLES,
  type EventLifecycle,
} from '../ports/event-performance.port';
import { ReportPeriodDto } from './report-common.dto';

/** One event's standing, best-first by registrations (US-RPT-04). */
export class EventPerformanceRowDto {
  @ApiProperty({ format: 'uuid' }) eventId!: string;
  @ApiProperty({ example: 'Tech Summit 2026' }) eventName!: string;

  @ApiProperty({ format: 'date-time', description: 'When it starts, UTC.' })
  startAt!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'BITEC',
    description:
      'The venue, or “Online”. Null where an in-person event has no venue recorded — not a claim that it is online.',
  })
  venue!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Bangkok' })
  city!: string | null;

  @ApiProperty({
    enum: EVENT_LIFECYCLES,
    description:
      'Worked out from the clock. `events.status` is not maintained past publication, so it is not what this reports.',
  })
  lifecycle!: EventLifecycle;

  @ApiProperty({ description: 'Confirmed seats — what the ranking is by.' })
  registrations!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Net of VAT and refunds, integer satang, all time for this event. Null when the caller has no finance access — withheld, never zeroed.',
  })
  revenueSatang!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Percent of ticket holders who arrived. Null for an event that has not started, and for one that issued nothing — never a misleading zero.',
  })
  attendanceRate!: number | null;
}

export class EventsReportDto {
  @ApiProperty({ type: ReportPeriodDto })
  period!: ReportPeriodDto;

  @ApiProperty({
    type: [EventPerformanceRowDto],
    description:
      'Best-first by registrations. An event with none still appears.',
  })
  rows!: EventPerformanceRowDto[];

  @ApiProperty({
    description: 'How many events the filter matched in total, for paging.',
  })
  matchedEvents!: number;
}
