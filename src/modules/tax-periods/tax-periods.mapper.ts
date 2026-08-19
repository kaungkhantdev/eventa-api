import { formatBaht } from '../../common/money/baht';
import type { TaxPeriodDto, VatHeadlinesDto } from './dto/tax-periods.dto';
import type { TaxPeriodRow, VatHeadlines } from './tax-periods.types';

/** One month of the VAT ledger, with the Baht labels the console prints. */
export function toTaxPeriod(row: TaxPeriodRow): TaxPeriodDto {
  return {
    year: row.year,
    month: row.month,
    period: row.period,
    dueAt: row.dueAt,
    salesSatang: row.salesSatang,
    vatSatang: row.vatSatang,
    salesLabel: formatBaht(row.salesSatang),
    vatLabel: formatBaht(row.vatSatang),
    whtSatang: row.whtSatang,
    remittedSatang: row.remittedSatang,
    status: row.status,
    filedAt: row.filedAt?.toISOString() ?? null,
    late: row.late,
    // Server-side, so the console never offers a filing the API would refuse.
    canFile: row.status === 'due',
  };
}

export function toVatHeadlines(headlines: VatHeadlines): VatHeadlinesDto {
  return {
    ...headlines,
    vatPayableLabel: formatBaht(headlines.vatPayableSatang),
  };
}
