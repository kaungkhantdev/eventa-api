import { taxStatusEnum } from '../../db/schema';

/** Derived from the Drizzle enum so the two can never drift apart. */
export type TaxStatus = (typeof taxStatusEnum.enumValues)[number];

/** One month of the VAT ledger, as the console reads it. */
export interface TaxPeriodRow {
  year: number;
  /** 1-based, as months are written. */
  month: number;
  period: string;
  dueAt: string;
  /** Taxable base, ex-VAT. */
  salesSatang: number;
  /** VAT collected on that base. */
  vatSatang: number;
  /** Withholding tax (Thai PND), tracked separately from VAT. */
  whtSatang: number;
  remittedSatang: number;
  status: TaxStatus;
  filedAt: Date | null;
  late: boolean;
}

/** The year's headlines. `payable` is always `collected − remitted`. */
export interface VatHeadlines {
  vatCollectedSatang: number;
  vatRemittedSatang: number;
  vatPayableSatang: number;
  withholdingSatang: number;
}

/** A month's VAT-inclusive takings, net of refunds settled in that month. */
export interface MonthlyTakings {
  year: number;
  month: number;
  grossSatang: number;
}

/** What a filed period froze. */
export interface FiledPeriod {
  year: number;
  month: number;
  salesSatang: number;
  vatSatang: number;
  whtSatang: number;
  remittedSatang: number;
  filedAt: Date;
}
