import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Ask for the confirmation link again (US-ACC-01). */
export class ResendVerificationDto {
  @ApiProperty({ example: 'owner@acme.co.th' })
  @Transform(trim)
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({
    enum: ['admin', 'attendee'],
    default: 'admin',
    description:
      'Which realm the account is in. The same address may hold both, and they confirm separately.',
  })
  @IsOptional()
  @IsIn(['admin', 'attendee'])
  persona?: 'admin' | 'attendee';
}
