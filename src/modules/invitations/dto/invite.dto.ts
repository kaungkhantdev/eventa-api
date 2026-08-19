import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MAX_MESSAGE_LENGTH } from '../invitations.types';

const MAX_NAME = 120;

/** Invite one named person to one event (US-REG-06). */
export class SendInviteDto {
  @ApiProperty({ format: 'uuid', description: 'Exactly one event.' })
  @IsUUID()
  eventId!: string;

  @ApiProperty({ example: 'Anan Suksawat' })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NAME)
  recipientName!: string;

  @ApiProperty({ example: 'anan@example.com' })
  @IsEmail()
  recipientEmail!: string;

  @ApiPropertyOptional({
    maxLength: MAX_MESSAGE_LENGTH,
    description: 'A personal note shown at the top of the invitation email.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_MESSAGE_LENGTH)
  message?: string;
}

export class InviteResultDto {
  @ApiProperty({
    description:
      'False when an identical invite went out recently — suppressed, not failed.',
  })
  sent!: boolean;

  @ApiProperty({ example: 'anan@example.com' })
  recipientEmail!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  sentAt!: string;
}
