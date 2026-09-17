import { ApiProperty } from '@nestjs/swagger';
import { PeriodChangeDto, ReportPeriodDto } from './report-common.dto';

/** Money for one scope, integer satang throughout (US-RPT-05). */
export class IncomeFiguresDto {
  @ApiProperty({ description: 'Collected from buyers, VAT included.' })
  grossSatang!: number;

  @ApiProperty({
    description:
      'The VAT portion of gross — the Revenue Department’s, not the organizer’s.',
  })
  vatSatang!: number;

  @ApiProperty({ description: 'Refunded against those payments, in full.' })
  refundsSatang!: number;

  @ApiProperty({ description: 'Charged by the payment provider.' })
  feesSatang!: number;

  @ApiProperty({
    description:
      'gross − VAT − refunds. The revenue figure, matching the dashboard and the overview.',
  })
  netSatang!: number;

  @ApiProperty({
    description:
      'net − fees. What actually reaches the organization’s account.',
  })
  settledSatang!: number;
}

export class IncomeReportRowDto extends IncomeFiguresDto {
  @ApiProperty({ format: 'uuid' }) eventId!: string;
  @ApiProperty({ example: 'Tech Summit 2026' }) eventName!: string;

  @ApiProperty({ format: 'date-time' }) startAt!: string;
}

/** Each money tile's move against the previous equal period (US-RPT-02). */
export class IncomeChangesDto {
  @ApiProperty({ type: PeriodChangeDto }) grossSatang!: PeriodChangeDto;

  @ApiProperty({
    type: PeriodChangeDto,
    description:
      'Carries no verdict — `improved` is always null. VAT was never the organizer’s to gain or lose.',
  })
  vatSatang!: PeriodChangeDto;

  @ApiProperty({
    type: PeriodChangeDto,
    description: 'Money leaving — falling is the improvement.',
  })
  refundsSatang!: PeriodChangeDto;

  @ApiProperty({
    type: PeriodChangeDto,
    description: 'Also money leaving — falling is the improvement.',
  })
  feesSatang!: PeriodChangeDto;

  @ApiProperty({ type: PeriodChangeDto }) netSatang!: PeriodChangeDto;
  @ApiProperty({ type: PeriodChangeDto }) settledSatang!: PeriodChangeDto;
}

export class IncomeReportDto {
  @ApiProperty({ type: ReportPeriodDto })
  period!: ReportPeriodDto;

  @ApiProperty({ type: [IncomeReportRowDto] })
  rows!: IncomeReportRowDto[];

  @ApiProperty({
    description:
      'How many events the filter matched in total, for paging the rows.',
  })
  matchedEvents!: number;

  @ApiProperty({
    type: IncomeFiguresDto,
    description: 'Summed across the whole filter, not the page shown.',
  })
  totals!: IncomeFiguresDto;

  @ApiProperty({
    type: IncomeChangesDto,
    description: 'How each total moved against the previous equal period.',
  })
  changes!: IncomeChangesDto;
}
