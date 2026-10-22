import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import {
  PAYMENT_METHOD_CHOICES,
  type PaymentMethodChoice,
} from '../ports/payment-provider.port';
import {
  MAX_IDEMPOTENCY_KEY,
  MIN_IDEMPOTENCY_KEY,
} from '../../../common/constants/payments.constants';

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

  @ApiProperty({ enum: PAYMENT_METHOD_CHOICES })
  @IsIn(PAYMENT_METHOD_CHOICES)
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
