import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

const MAX_REASON = 500;

/** Why an invoice was raised in error (US-FIN-10). Optional, but recorded. */
export class VoidInvoiceDto {
  @ApiPropertyOptional({
    maxLength: MAX_REASON,
    example: 'Raised against the wrong order',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REASON)
  reason?: string;
}
