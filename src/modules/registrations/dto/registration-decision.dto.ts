import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

/** A rejection reason is for the organizer's own records and the notice email. */
export const MAX_REJECTION_REASON = 500;

export class RejectRegistrationDto {
  @ApiProperty({
    description:
      'Must be true. Rejecting is terminal, so it is never the default (US-REG-02).',
  })
  @Type(() => Boolean)
  @IsBoolean()
  confirm!: boolean;

  @ApiPropertyOptional({ maxLength: MAX_REJECTION_REASON })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REJECTION_REASON)
  reason?: string;
}

export class DecisionOutcomeDto {
  @ApiProperty({
    enum: ['approved', 'already_approved', 'rejected'],
    description:
      '`already_approved` means a retry found the work already done — no second ticket, no second email.',
  })
  outcome!: 'approved' | 'already_approved' | 'rejected';

  @ApiProperty({ example: 'ORD-2026-0009' })
  reference!: string;

  @ApiProperty({ description: 'Tickets now issued against this registration.' })
  ticketCount!: number;
}
