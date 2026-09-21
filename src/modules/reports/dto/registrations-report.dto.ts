import { ApiProperty } from '@nestjs/swagger';
import { PeriodChangeDto, ReportPeriodDto } from './report-common.dto';

/** Seats by order state. The five sum to `total` (US-RPT-08). */
export class RegistrationSplitDto {
  @ApiProperty() confirmed!: number;
  @ApiProperty() pending!: number;
  @ApiProperty() waitlisted!: number;

  @ApiProperty({ description: 'Withdrawn by the buyer, or refunded.' })
  cancelled!: number;

  @ApiProperty({
    description:
      'Turned down by an organizer — distinct from cancelled, and never re-approved.',
  })
  rejected!: number;

  @ApiProperty({ description: 'The sum of the five states above.' })
  total!: number;
}

export class RegistrationsReportRowDto extends RegistrationSplitDto {
  @ApiProperty({ format: 'uuid' }) eventId!: string;
  @ApiProperty({ example: 'Tech Summit 2026' }) eventName!: string;

  @ApiProperty({
    format: 'date-time',
    description: 'When the event starts, UTC.',
  })
  startAt!: string;
}

/** Each tile's move against the previous equal period (US-RPT-02). */
export class RegistrationChangesDto {
  @ApiProperty({ type: PeriodChangeDto }) confirmed!: PeriodChangeDto;
  @ApiProperty({ type: PeriodChangeDto }) pending!: PeriodChangeDto;
  @ApiProperty({ type: PeriodChangeDto }) waitlisted!: PeriodChangeDto;

  @ApiProperty({
    type: PeriodChangeDto,
    description: 'A registration lost — falling is the improvement.',
  })
  cancelled!: PeriodChangeDto;

  @ApiProperty({
    type: PeriodChangeDto,
    description: 'Also a loss — falling is the improvement.',
  })
  rejected!: PeriodChangeDto;

  @ApiProperty({ type: PeriodChangeDto }) total!: PeriodChangeDto;
}

export class RegistrationsReportDto {
  @ApiProperty({ type: ReportPeriodDto })
  period!: ReportPeriodDto;

  @ApiProperty({ type: [RegistrationsReportRowDto] })
  rows!: RegistrationsReportRowDto[];

  @ApiProperty({
    description:
      'How many events the filter matched in total, for paging the rows.',
  })
  matchedEvents!: number;

  @ApiProperty({
    type: RegistrationSplitDto,
    description:
      'Summed across everything the filter matched, not just the page shown.',
  })
  totals!: RegistrationSplitDto;

  @ApiProperty({
    type: RegistrationChangesDto,
    description: 'How each total moved against the previous equal period.',
  })
  changes!: RegistrationChangesDto;
}
