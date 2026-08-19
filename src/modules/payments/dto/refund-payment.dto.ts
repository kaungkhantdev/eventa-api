import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

const MIN_KEY = 8;
const MAX_KEY = 128;

/**
 * Issue a full refund (US-FIN-02). Note what is absent: an amount. Full refunds
 * only this release, and the figure comes from the payment — a client-supplied
 * number is a way to refund more than was ever charged.
 */
export class RefundPaymentDto {
  @ApiProperty({
    description:
      'Exactly-once key. Resubmitting the same one returns the first refund rather than issuing a second.',
  })
  @IsString()
  @MinLength(MIN_KEY)
  @MaxLength(MAX_KEY)
  idempotencyKey!: string;
}

/** What the refund turned out to be. */
export class RefundResponseDto {
  @ApiProperty({ format: 'uuid' })
  refundId!: string;

  @ApiProperty({
    enum: ['pending', 'succeeded', 'failed'],
    description:
      'pending means the provider accepted it but the money has not landed back yet (PromptPay)',
  })
  status!: string;

  @ApiProperty({ example: 188000, description: 'Integer satang' })
  amountSatang!: number;
}
