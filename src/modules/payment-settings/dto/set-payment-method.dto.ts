import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/** Turn one checkout method on or off (US-SET-09). */
export class SetPaymentMethodDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}
