import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { payoutStatusEnum } from '../../../db/schema';
import type { PayoutStatus } from '../payouts.types';
import type { TimelineEntry } from '../payout-timeline';

const MAX_LIMIT = 100;

export class ListPayoutsDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_LIMIT, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ enum: payoutStatusEnum.enumValues })
  @IsOptional()
  @IsIn(payoutStatusEnum.enumValues)
  status?: PayoutStatus;
}

export class PayoutEntryDto {
  @ApiProperty({ example: 'PO-2026-0001' })
  reference!: string;

  @ApiProperty({ example: 8_000_000 })
  amountSatang!: number;

  @ApiProperty({ example: '฿80,000' })
  amountLabel!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({
    example: '•••• 7890',
    description: 'Masked — Eventa never stores a bank account number.',
  })
  bankAccount!: string;

  @ApiProperty({ enum: payoutStatusEnum.enumValues })
  status!: PayoutStatus;

  @ApiProperty({ nullable: true, example: 'Jun 2026' })
  periodCovered!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  requestedAt!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  completedAt!: string | null;

  @ApiProperty({ nullable: true, example: 'account_closed' })
  failureReason!: string | null;

  @ApiProperty({ description: 'Whether an Admin may retry this payout now.' })
  canRetry!: boolean;
}

export class TimelineEntryDto {
  @ApiProperty({ enum: ['requested', 'processing', 'paid'] })
  step!: TimelineEntry['step'];

  @ApiProperty()
  done!: boolean;

  @ApiProperty({ nullable: true })
  note!: string | null;
}

export class PayoutDetailDto extends PayoutEntryDto {
  @ApiProperty({ type: [TimelineEntryDto] })
  timeline!: TimelineEntryDto[];

  @ApiProperty({ description: 'A receipt exists only once the money landed.' })
  canDownloadReceipt!: boolean;
}

/** The three headline balances (US-FIN-03); null until payouts are connected. */
export class BalancesDto {
  @ApiProperty({ nullable: true, example: 30_000_000 })
  availableSatang!: number | null;

  @ApiProperty({ nullable: true, example: 8_000_000 })
  pendingSatang!: number | null;

  @ApiProperty({ nullable: true, example: 20_000_000 })
  paidOutSatang!: number | null;

  @ApiProperty({ nullable: true, example: '฿300,000' })
  availableLabel!: string | null;

  @ApiProperty({ nullable: true, example: '฿80,000' })
  pendingLabel!: string | null;

  @ApiProperty({ nullable: true, example: '฿200,000' })
  paidOutLabel!: string | null;

  @ApiProperty({ description: 'False until a payout account is connected.' })
  payoutsConnected!: boolean;
}

/** Where to manage bank details, schedule and tax forms (US-FIN-05). */
export class PayoutSettingsLinkDto {
  @ApiProperty()
  connected!: boolean;

  @ApiProperty({
    nullable: true,
    description: 'One-time provider URL; null until an account is connected.',
  })
  url!: string | null;
}
