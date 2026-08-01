import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/** The token from the confirmation link (US-SET-01). */
export class ConfirmEmailDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  token!: string;
}
