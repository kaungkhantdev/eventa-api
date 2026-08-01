import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { RegistrationStatusFilter } from '../../ports/event-stats.port';

const STATUSES: readonly RegistrationStatusFilter[] = [
  'paid',
  'pending',
  'refunded',
];

/** Query for the Registrations tab: paging + an optional payment-status filter. */
export class RegistrationsQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    enum: STATUSES,
    description: 'Filter by payment status',
  })
  @IsOptional()
  @IsIn(STATUSES)
  status?: RegistrationStatusFilter;
}
