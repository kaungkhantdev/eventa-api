import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { taxStatusEnum } from '../../../db/schema';
import type { TaxStatus } from '../tax-periods.types';

/** Thai VAT filing started long after this; a typo'd year is a bug, not data. */
const MIN_YEAR = 2020;
const MAX_YEAR = 2100;
const MAX_WHT_SATANG = 1_000_000_000_000;

export class ListTaxPeriodsDto {
  @ApiProperty({ minimum: MIN_YEAR, maximum: MAX_YEAR, example: 2026 })
  @Type(() => Number)
  @IsInt()
  @Min(MIN_YEAR)
  @Max(MAX_YEAR)
  year!: number;

  @ApiPropertyOptional({ enum: taxStatusEnum.enumValues })
  @IsOptional()
  @IsIn(taxStatusEnum.enumValues)
  status?: TaxStatus;
}

/** Record the PP30 filing for a period (US-FIN-12). */
export class FileTaxPeriodDto {
  @ApiPropertyOptional({
    minimum: 0,
    description:
      'Withholding tax (Thai PND) reconciled for this period, in satang.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_WHT_SATANG)
  whtSatang?: number;
}

export class TaxPeriodDto {
  @ApiProperty({ example: 2026 })
  year!: number;

  @ApiProperty({ example: 6, description: '1-based month.' })
  month!: number;

  @ApiProperty({ example: 'Jun' })
  period!: string;

  @ApiProperty({
    example: '2026-07-15',
    description: '15th of the next month.',
  })
  dueAt!: string;

  @ApiProperty({ example: 301_280_000, description: 'Taxable base, ex-VAT.' })
  salesSatang!: number;

  @ApiProperty({ example: 21_089_600, description: 'VAT collected on it.' })
  vatSatang!: number;

  @ApiProperty({ example: '฿3,012,800' })
  salesLabel!: string;

  @ApiProperty({ example: '฿210,896' })
  vatLabel!: string;

  @ApiProperty({ example: 0, description: 'Withholding tax (Thai PND).' })
  whtSatang!: number;

  @ApiProperty({ example: 0 })
  remittedSatang!: number;

  @ApiProperty({ enum: taxStatusEnum.enumValues })
  status!: TaxStatus;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  filedAt!: string | null;

  @ApiProperty({ description: 'Filed after the 15th — recorded, not blocked.' })
  late!: boolean;

  @ApiProperty({ description: 'Whether an Admin may record a filing now.' })
  canFile!: boolean;
}

/** The year's tax position. `payable` is always `collected − remitted`. */
export class VatHeadlinesDto {
  @ApiProperty({ example: 21_089_600 })
  vatCollectedSatang!: number;

  @ApiProperty({ example: 0 })
  vatRemittedSatang!: number;

  @ApiProperty({ example: 21_089_600 })
  vatPayableSatang!: number;

  @ApiProperty({ example: 0, description: 'Tracked separately from VAT.' })
  withholdingSatang!: number;

  @ApiProperty({ example: '฿210,896' })
  vatPayableLabel!: string;
}

/** The VAT ledger: twelve rows plus the year's headline position. */
export class VatLedgerDto {
  @ApiProperty({ type: [TaxPeriodDto] })
  periods!: TaxPeriodDto[];

  @ApiProperty({ type: VatHeadlinesDto })
  headlines!: VatHeadlinesDto;
}
