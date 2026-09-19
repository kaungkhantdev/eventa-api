import { ApiProperty } from '@nestjs/swagger';
import {
  DISCOUNT_STANDINGS,
  type DiscountStanding,
} from '../ports/discount-report.port';
import { ReportPeriodDto } from './report-common.dto';

/** One code's payback (US-RPT-10). */
export class DiscountPerformanceRowDto {
  @ApiProperty({ format: 'uuid' }) discountId!: string;
  @ApiProperty({ example: 'EARLYBIRD' }) code!: string;

  @ApiProperty({ enum: DISCOUNT_STANDINGS })
  standing!: DiscountStanding;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '25% off',
    description: 'A percentage code’s terms. Null for a fixed one — see below.',
  })
  terms!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'What a FIXED code takes off, integer satang; null for a percentage one. Money stays an integer until the edge formats it.',
  })
  fixedValueSatang!: number | null;

  @ApiProperty({ example: 'All events' }) scope!: string;

  @ApiProperty({ description: 'Redemptions on confirmed orders, all time.' })
  redemptions!: number;

  @ApiProperty({ description: 'What buyers were let off, integer satang.' })
  discountSatang!: number;

  @ApiProperty({
    description:
      'The value of the confirmed orders this code was used on, after the discount. Order value, NOT the income report’s settled net.',
  })
  influencedSatang!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Baht of orders per Baht given away. Null for a code nobody has used, and for one that cost nothing — never a stand-in zero.',
  })
  returnRatio!: number | null;
}

export class DiscountTotalsDto {
  @ApiProperty() activeCodes!: number;
  @ApiProperty() redemptions!: number;
  @ApiProperty() discountSatang!: number;
  @ApiProperty() influencedSatang!: number;

  @ApiProperty({ type: Number, nullable: true })
  returnRatio!: number | null;
}

export class DiscountsReportDto {
  @ApiProperty({ type: ReportPeriodDto }) period!: ReportPeriodDto;

  @ApiProperty({
    type: [DiscountPerformanceRowDto],
    description:
      'Best-first by the sales they influenced. A scheduled code nobody has used still appears, reading zero.',
  })
  rows!: DiscountPerformanceRowDto[];

  @ApiProperty({ description: 'How many codes matched, for paging.' })
  matchedCodes!: number;

  @ApiProperty({ type: DiscountTotalsDto })
  totals!: DiscountTotalsDto;
}
