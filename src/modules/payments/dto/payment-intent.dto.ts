import { ApiProperty } from '@nestjs/swagger';
import { paymentMethodEnum, paymentStatusEnum } from '../../../db/schema';

/**
 * What the browser needs to finish paying (US-DISC-05). Never card data: for a
 * card, `clientSecret` hands off to the provider's hosted fields; for PromptPay,
 * `promptPayQr` is a bank-scannable payload for the exact total.
 */
export class PaymentIntentDto {
  @ApiProperty({ format: 'uuid' })
  paymentId!: string;

  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ enum: paymentMethodEnum.enumValues })
  method!: string;

  @ApiProperty({ enum: paymentStatusEnum.enumValues })
  status!: string;

  @ApiProperty({
    example: 210_000,
    description: 'The order total, VAT included',
  })
  amountSatang!: number;

  @ApiProperty({ example: '฿2,100' })
  amountLabel!: string;

  @ApiProperty({ nullable: true, type: String, description: 'Card only' })
  clientSecret!: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'PromptPay only' })
  promptPayQr!: string | null;

  @ApiProperty({
    format: 'date-time',
    nullable: true,
    type: String,
    description: 'When a PromptPay code stops being scannable',
  })
  expiresAt!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'Your card was declined. Please try another card.',
    description:
      'Set when the attempt was declined — try again or switch method',
  })
  declineReason!: string | null;
}
