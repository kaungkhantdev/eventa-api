import { ApiProperty } from '@nestjs/swagger';
import { type TrendGranularity } from '../revenue-trend';
import { PeriodChangeDto, ReportPeriodDto } from './report-common.dto';
import { TREND_GRANULARITIES } from '../../../common/constants/reports.constants';

export class OverviewKpiDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Null when the figure is genuinely unknown — never a stand-in zero. Render “—”.',
  })
  value!: number | null;

  @ApiProperty({ type: PeriodChangeDto })
  change!: PeriodChangeDto;
}

/** One bar on the revenue chart. */
export class RevenueTrendPointDto {
  @ApiProperty({
    example: '2026-07-01',
    description: 'The Bangkok calendar day the bucket opens on.',
  })
  at!: string;

  @ApiProperty({
    description: 'Gross less refunds and fees, integer satang.',
  })
  netSatang!: number;
}

export class RevenueTrendDto {
  @ApiProperty({
    enum: TREND_GRANULARITIES,
    description:
      'The bucket each point covers, chosen from the length of the window.',
  })
  granularity!: TrendGranularity;

  @ApiProperty({
    description:
      'The same figure as the revenue tile — the sum of the points, gross less refunds and fees.',
  })
  totalSatang!: number;

  @ApiProperty({ type: PeriodChangeDto })
  change!: PeriodChangeDto;

  @ApiProperty({
    type: [RevenueTrendPointDto],
    description:
      'Every bucket in the window, oldest first. A quiet bucket is zero, not absent.',
  })
  points!: RevenueTrendPointDto[];
}

/**
 * The five headline tiles.
 *
 * The three money tiles are null together, and only for a caller without
 * `finView` (US-RPT-12) — withheld, never zeroed.
 */
export class OverviewKpisDto {
  @ApiProperty({
    type: OverviewKpiDto,
    description:
      'Seats registered in the window — the registrations report’s total for the same scope.',
  })
  registrations!: OverviewKpiDto;

  @ApiProperty({
    type: OverviewKpiDto,
    description:
      'Percent of those expected at events that have STARTED who arrived. Null value when nobody was expected.',
  })
  attendanceRate!: OverviewKpiDto;

  @ApiProperty({
    type: OverviewKpiDto,
    nullable: true,
    description:
      'Gross less refunds and fees, integer satang — the same figure as the Income report’s net for this scope.',
  })
  revenueSatang!: OverviewKpiDto | null;

  @ApiProperty({
    type: OverviewKpiDto,
    nullable: true,
    description:
      'Gross per paid seat, VAT included — what a buyer was charged. Null value when nothing was sold.',
  })
  averageTicketSatang!: OverviewKpiDto | null;

  @ApiProperty({
    type: OverviewKpiDto,
    nullable: true,
    description:
      'Refunds as a percent of gross. Falling is an improvement. Null value when no money was taken.',
  })
  refundRate!: OverviewKpiDto | null;
}

/** One slice of the ticket-type donut (US-RPT-03). */
export class TicketMixSliceDto {
  @ApiProperty({ example: 'General Admission' }) ticketTypeName!: string;

  @ApiProperty({
    description:
      'Seats of this type, in the same order states as the registrations total.',
  })
  seats!: number;

  @ApiProperty({
    description:
      'Share of the MIX, to one decimal — the slices add up to the whole. Not a share of the registrations tile, which can also count a sign-up with no ticket type.',
  })
  percent!: number;
}

export class OverviewReportDto {
  @ApiProperty({ type: ReportPeriodDto })
  period!: ReportPeriodDto;

  @ApiProperty({ type: OverviewKpisDto })
  kpis!: OverviewKpisDto;

  @ApiProperty({
    type: RevenueTrendDto,
    nullable: true,
    description: 'Null without finance access: the panel is not shown at all.',
  })
  revenue!: RevenueTrendDto | null;

  @ApiProperty({
    type: [TicketMixSliceDto],
    description:
      'Largest share first. Empty when nothing was sold in the window — an empty donut, not a ring of zero-width slices.',
  })
  ticketMix!: TicketMixSliceDto[];
}
