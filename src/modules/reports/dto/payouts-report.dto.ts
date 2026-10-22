import { ApiProperty } from '@nestjs/swagger';
import { type ReportPayoutStatus } from '../ports/payout-report.port';
import { ReportPeriodDto } from './report-common.dto';
import { REPORT_PAYOUT_STATUSES } from '../../../common/constants/reports.constants';

/** An event a payout settles money for. */
export class PayoutCoveredEventDto {
  @ApiProperty({ format: 'uuid' }) eventId!: string;
  @ApiProperty({ example: 'Tech Summit 2026' }) eventName!: string;
}

/** One payout to the organization's bank (US-RPT-07). */
export class PayoutRowDto {
  @ApiProperty({
    example: 'PO-2043',
    description: 'Unique within the workspace — what to quote to the bank.',
  })
  reference!: string;

  @ApiProperty({
    format: 'date-time',
    description:
      'When it landed, or when it was requested if it has not landed yet.',
  })
  at!: string;

  @ApiProperty({
    example: '•••• 6042',
    description:
      'The destination account, masked to its last four digits — never more.',
  })
  bankAccount!: string;

  @ApiProperty({
    type: [PayoutCoveredEventDto],
    description:
      'Every event whose payments this payout settles. Empty when it carries none.',
  })
  events!: PayoutCoveredEventDto[];

  @ApiProperty({ description: 'Integer satang.' })
  amountSatang!: number;

  @ApiProperty({
    enum: REPORT_PAYOUT_STATUSES,
    description:
      'paid · in_transit (sent, not yet landed) · pending (scheduled, not yet sent). A failed payout is not in this report — see GET /payouts.',
  })
  status!: ReportPayoutStatus;
}

export class PayoutTotalsDto {
  @ApiProperty({
    description:
      'Payouts matched — each counted once, however many events it covers.',
  })
  payouts!: number;

  @ApiProperty({ description: 'Paid, integer satang.' })
  paidOutSatang!: number;

  @ApiProperty({ description: 'Sent and not yet landed, integer satang.' })
  inTransitSatang!: number;

  @ApiProperty({
    description:
      'Scheduled and not yet sent, integer satang. Not the same figure as GET /payouts/balances pendingSatang, which also counts what is in transit.',
  })
  pendingSatang!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'The mean of every payout matched, whole satang. Null when none matched.',
  })
  averageSatang!: number | null;
}

export class PayoutsReportDto {
  @ApiProperty({ type: ReportPeriodDto }) period!: ReportPeriodDto;
  @ApiProperty({ type: [PayoutRowDto] }) rows!: PayoutRowDto[];

  @ApiProperty({ description: 'How many payouts matched, for paging.' })
  matchedPayouts!: number;

  @ApiProperty({ type: PayoutTotalsDto }) totals!: PayoutTotalsDto;
}
