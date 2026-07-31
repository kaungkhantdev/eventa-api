import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, MaxLength } from 'class-validator';
import { Persona } from '../auth.types';

/** Body for requesting a password-reset link (US-ACC-04). */
export class ForgotPasswordDto {
  @ApiProperty({ example: 'owner@acme.co.th' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiPropertyOptional({
    enum: [Persona.Admin, Persona.Attendee],
    default: Persona.Admin,
    description: 'Which audience account to reset (defaults to organizer).',
  })
  @IsOptional()
  @IsIn([Persona.Admin, Persona.Attendee])
  persona?: Persona;
}
