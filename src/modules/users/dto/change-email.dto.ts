import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

/** Ask to move the account to a new address (US-SET-01). */
export class ChangeEmailDto {
  @ApiProperty({ example: 'new@acme.co.th' })
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
