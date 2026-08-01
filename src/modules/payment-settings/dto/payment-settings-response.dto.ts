import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PaymentSettingsRow } from '../payment-settings.types';

/**
 * A workspace's payment connection + checkout preferences. Carries **no secret**
 * — by design nothing sensitive is stored, so nothing needs masking here.
 */
export class PaymentSettingsResponseDto {
  @ApiProperty({ enum: ['stripe'] }) provider!: string;
  @ApiProperty({ enum: ['test', 'live'] }) mode!: string;
  @ApiProperty({ enum: ['disconnected', 'connected'] }) status!: string;
  @ApiProperty({ nullable: true, description: 'Provider account reference' })
  accountId!: string | null;
  @ApiProperty({ nullable: true, description: 'Non-secret, browser-safe key' })
  publishableKey!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  connectedAt!: string | null;
  @ApiProperty() defaultCurrency!: string;
  @ApiProperty({ nullable: true }) statementDescriptor!: string | null;
  @ApiProperty() saveCards!: boolean;
  @ApiProperty() emailReceipts!: boolean;
  @ApiProperty({
    description: 'True while in test mode — no real charges happen yet',
  })
  testMode!: boolean;
  @ApiPropertyOptional({
    type: [String],
    description: 'Non-blocking advisories',
  })
  warnings?: string[];
}

export function toPaymentSettingsResponse(
  row: PaymentSettingsRow,
): PaymentSettingsResponseDto {
  return {
    provider: row.provider,
    mode: row.mode,
    status: row.status,
    accountId: row.accountId,
    publishableKey: row.publishableKey,
    connectedAt: row.connectedAt?.toISOString() ?? null,
    defaultCurrency: row.defaultCurrency,
    statementDescriptor: row.statementDescriptor,
    saveCards: row.saveCards,
    emailReceipts: row.emailReceipts,
    testMode: row.mode === 'test',
    warnings: [],
  };
}
