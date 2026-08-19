import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches, MaxLength } from 'class-validator';
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

  @ApiProperty({ example: 'pk_test_51A2b3C' })
  @IsString()
  @MaxLength(255)
  publishableKey!: string;

  @ApiProperty({ enum: MODES, example: 'test' })
  @IsIn([...MODES])
  mode!: (typeof MODES)[number];
}
