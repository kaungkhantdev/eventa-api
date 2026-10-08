import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PeriodChangeDto, ReportPeriodDto } from './report-common.dto';

/**
 * Every rate is nullable, and the nulls carry meaning (US-RPT-09): an event
 * that has not started has no attendance to report, and that is different from
 * an event nobody attended.
 */
export class AttendanceReportRowDto {
  @ApiProperty({ format: 'uuid' }) eventId!: string;
  @ApiProperty({ example: 'Tech Summit 2026' }) eventName!: string;
  @ApiProperty({ format: 'date-time' }) startAt!: string;

  @ApiProperty({ description: 'Live tickets issued for the event.' })
  registered!: number;

  @ApiProperty() checkedIn!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Null before the event starts — nobody is missing yet.',
  })
  noShows!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Percent. Null before the event starts, or with nothing sold.',
  })
  attendanceRate!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Of those who came, the share who arrived before the start.',
  })
  onTimeRate!: number | null;
}

export class AttendanceTotalsDto {
  @ApiProperty({ description: 'Every check-in in the window.' })
  checkedIn!: number;

  @ApiPropertyOptional({ nullable: true }) noShows!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Over events that have started only.',
  })
  attendanceRate!: number | null;

  @ApiPropertyOptional({ nullable: true }) onTimeRate!: number | null;
}

/** Each tile's move against the previous equal period (US-RPT-02). */
export class AttendanceChangesDto {
  @ApiProperty({ type: PeriodChangeDto }) checkedIn!: PeriodChangeDto;

  @ApiProperty({
    type: PeriodChangeDto,
    description: 'People who did not arrive — falling is the improvement.',
  })
  noShows!: PeriodChangeDto;

  @ApiProperty({ type: PeriodChangeDto }) attendanceRate!: PeriodChangeDto;
  @ApiProperty({ type: PeriodChangeDto }) onTimeRate!: PeriodChangeDto;
}

export class AttendanceReportDto {
  @ApiProperty({ type: ReportPeriodDto }) period!: ReportPeriodDto;
  @ApiProperty({ type: [AttendanceReportRowDto] })
  rows!: AttendanceReportRowDto[];

  @ApiProperty({
    description:
      'How many events the filter matched in total, for paging the rows.',
  })
  matchedEvents!: number;
  @ApiProperty({ type: AttendanceTotalsDto }) totals!: AttendanceTotalsDto;

  @ApiProperty({
    type: AttendanceChangesDto,
    description: 'How each total moved against the previous equal period.',
  })
  changes!: AttendanceChangesDto;
}
