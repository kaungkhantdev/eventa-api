import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

export class CalendarQueryDto {
  @ApiPropertyOptional({
    example: '2026-09',
    description: 'YYYY-MM (Asia/Bangkok); defaults to the current month',
  })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be YYYY-MM' })
  month?: string;
}
