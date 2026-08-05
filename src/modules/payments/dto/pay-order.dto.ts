import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import type { PaymentMethodChoice } from '../ports/payment-provider.port';

const METHODS: readonly PaymentMethodChoice[] = ['Card', 'PromptPay'];
const MIN_IDEMPOTENCY_KEY = 8;
const MAX_IDEMPOTENCY_KEY = 128;

/**
 * Start collecting an order's total (US-DISC-05). Note what is absent: any
 * amount, and anything card-shaped. The amount is the order's own total, read
 * server-side; card details go straight into the provider's hosted fields and
 * never pass through this API (PCI SAQ-A).
 */
export class PayOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ enum: METHODS })
  @IsIn(METHODS)
  method!: PaymentMethodChoice;

  @ApiProperty({
    minLength: MIN_IDEMPOTENCY_KEY,
    description:
      'The client’s key for this attempt. Replaying it returns the same payment; a genuinely new attempt (retry after a decline, a fresh PromptPay code) uses a new key.',
  })
  @IsString()
  @MinLength(MIN_IDEMPOTENCY_KEY)
  @MaxLength(MAX_IDEMPOTENCY_KEY)
  idempotencyKey!: string;
}
