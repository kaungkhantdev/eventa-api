import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@acme.test' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'correct horse battery staple', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;

  @ApiProperty({ example: 'acme', description: 'Workspace slug' })
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  orgSlug!: string;

  @ApiPropertyOptional({ enum: ['admin', 'attendee'], default: 'admin' })
  @IsOptional()
  @IsIn(['admin', 'attendee'])
  persona?: 'admin' | 'attendee';

  @ApiPropertyOptional({
    description: 'Stay signed in on this device for longer (US-ACC-08).',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
