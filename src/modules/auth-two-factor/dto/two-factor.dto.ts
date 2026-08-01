import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

/** A 6-digit app code, or a XXXXX-XXXXX recovery code. */
export class TwoFactorCodeDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 16)
  code!: string;
}

/** What the setup screen needs to render the QR (US-SET-03). */
export class TwoFactorStartDto {
  @ApiProperty({ description: 'Scan this with an authenticator app' })
  otpauthUri!: string;
  @ApiProperty({ description: 'Manual-entry fallback for the same seed' })
  secret!: string;
}

/** Shown exactly once, right after setup or a regeneration. */
export class RecoveryCodesDto {
  @ApiProperty({ type: [String], example: ['A1B2C-3D4E5'] })
  recoveryCodes!: string[];
}
