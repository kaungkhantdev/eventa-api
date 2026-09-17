import { ApiProperty } from '@nestjs/swagger';
import { ReportPeriodDto } from './registrations-report.dto';

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

export class IncomeReportDto {
  @ApiProperty({ type: ReportPeriodDto })
  period!: ReportPeriodDto;

  @ApiProperty({ type: [IncomeReportRowDto] })
  rows!: IncomeReportRowDto[];

  @ApiProperty({
    type: IncomeFiguresDto,
    description: 'Summed across the whole filter, not the page shown.',
  })
  totals!: IncomeFiguresDto;
}
