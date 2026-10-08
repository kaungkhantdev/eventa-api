import { ApiProperty } from '@nestjs/swagger';
import {
  LEDGER_OUTCOMES,
  type LedgerKind,
  type LedgerOutcome,
} from '../ports/transaction-ledger.port';
import { ReportPeriodDto } from './report-common.dto';

/** One entry in the ledger (US-RPT-06). */
export class TransactionRowDto {
  @ApiProperty({ example: 'payment:6f1c…' }) id!: string;

  @ApiProperty({ enum: ['payment', 'refund'] })
  kind!: LedgerKind;

  @ApiProperty({
    example: 'TXN-8842',
    description:
      'A payment’s own txn. A refund’s is DERIVED from its parent’s (TXN-8842-R1) — the schema stores none, so it is for reading, not for looking up.',
  })
  reference!: string;

  @ApiProperty({ format: 'date-time' }) at!: string;

  @ApiProperty({
    example: 'Ploy Srisai',
    description:
      'The payer. A group booking of six has one, so not an attendee.',
  })
  personName!: string;

  @ApiProperty({ format: 'uuid' }) eventId!: string;
  @ApiProperty({ example: 'Tech Summit 2026' }) eventName!: string;

  @ApiProperty({
    example: 'Card',
    description:
      'As the schema knows it — never a card brand. None is stored, and under PCI SAQ-A none will be.',
  })
  method!: string;

  @ApiProperty({
    description:
      'Always positive, integer satang. A refund’s minus sign belongs to the screen; a ledger of negatives makes every sum a trap.',
  })
  amountSatang!: number;

  @ApiProperty({ enum: LEDGER_OUTCOMES })
  outcome!: LedgerOutcome;

  @ApiProperty({
    format: 'uuid',
    description:
      'The payment this row concerns — a refund carries its parent’s.',
  })
  paymentId!: string;
}

export class TransactionTotalsDto {
  @ApiProperty({ description: 'Every entry, both legs.' }) entries!: number;
  @ApiProperty({ description: 'Charges that did not fail.' }) payments!: number;
  @ApiProperty() failed!: number;
  @ApiProperty() refunds!: number;

  @ApiProperty({
    description: 'Taken, integer satang. Excludes failed charges.',
  })
  collectedSatang!: number;

  @ApiProperty() refundedSatang!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Percent of ATTEMPTED charges that succeeded — a failure counts against it although its money is excluded above. Null when none were attempted.',
  })
  successRate!: number | null;
}

export class TransactionsReportDto {
  @ApiProperty({ type: ReportPeriodDto }) period!: ReportPeriodDto;
  @ApiProperty({ type: [TransactionRowDto] }) rows!: TransactionRowDto[];

  @ApiProperty({ description: 'How many entries matched, for paging.' })
  matchedEntries!: number;

  @ApiProperty({ type: TransactionTotalsDto }) totals!: TransactionTotalsDto;
}
