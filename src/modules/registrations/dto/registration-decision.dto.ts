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

export class OfferOutcomeDto {
  @ApiProperty({
    enum: ['offered', 'already_offered', 'confirmed'],
    description:
      '`offered` holds a seat until `offerExpiresAt`; `confirmed` is a free ticket, issued at once.',
  })
  outcome!: 'offered' | 'already_offered' | 'confirmed';

  @ApiProperty({ example: 'ORD-2026-0009' })
  reference!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    format: 'date-time',
    description: 'When an unpaid offer lapses and passes to the next in line.',
  })
  offerExpiresAt!: string | null;

  @ApiProperty({ description: 'Tickets issued now — only for a free ticket.' })
  ticketCount!: number;
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
