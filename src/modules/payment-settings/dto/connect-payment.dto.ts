import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { paymentModeEnum } from '../../../db/schema';

const MODES = paymentModeEnum.enumValues;

/**
 * Connect a provider account (US-SET-08). Deliberately accepts **no secret key** —
 * only the account reference and the publishable (browser-safe) key.
 */
export class ConnectPaymentDto {
  @ApiProperty({ example: 'acct_1A2b3C' })
  @IsString()
  @Matches(/^acct_[A-Za-z0-9]+$/, {
    message: 'accountId must look like acct_XXXX',
  })
  accountId!: string;

  /**
   * Optional, and unused by this product. Checkout happens on Stripe's own
   * hosted page, so the browser never loads Stripe.js and never needs a
   * publishable key — demanding one would be asking an organizer to go and
   * fetch a value nothing reads. Kept because it is cheap to record for a
   * future embedded flow, and because dropping the field outright would break
   * callers already sending it.
   */
  @ApiPropertyOptional({ example: 'pk_test_51A2b3C' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  publishableKey?: string;

  @ApiProperty({ enum: MODES, example: 'test' })
  @IsIn([...MODES])
  mode!: (typeof MODES)[number];
}
