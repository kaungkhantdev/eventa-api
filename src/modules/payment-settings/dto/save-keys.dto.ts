import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { paymentModeEnum } from '../../../db/schema';

const MODES = paymentModeEnum.enumValues;
/** Well above any real Stripe key; a bound, not a rule. */
const MAX_KEY = 255;

/**
 * The workspace's own Stripe keys (US-SET-08).
 *
 * Shape only. The rules that matter — that both keys are the right KIND, and
 * that both agree with the mode they are being saved under — live in
 * `stripe-keys.ts`, tested, because getting them wrong charges real cards
 * behind a screen that says nothing is charged.
 */
export class SaveKeysDto {
  @ApiProperty({ enum: MODES, example: 'test' })
  @IsIn([...MODES])
  mode!: (typeof MODES)[number];

  @ApiProperty({ example: 'pk_test_51P9xEventa0aB3kY7cQ' })
  @IsString()
  @MaxLength(MAX_KEY)
  publishableKey!: string;

  @ApiProperty({ example: 'sk_test_…' })
  @IsString()
  @MaxLength(MAX_KEY)
  secretKey!: string;

  /**
   * Optional on purpose. It comes from a different page in Stripe — the one
   * where the organizer registers this workspace's webhook URL — so re-pasting
   * API keys is not a statement about it. Omitted means "leave the stored one
   * alone"; blanking it silently would stop every order settling.
   */
  @ApiPropertyOptional({ example: 'whsec_…' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_KEY)
  webhookSecret?: string;
}
