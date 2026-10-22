import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { MAX_REASON } from '../../../common/constants/invoices.constants';

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
