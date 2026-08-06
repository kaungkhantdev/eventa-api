import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** Raise the tax invoice for one order (US-FIN-07). */
export class IssueInvoiceDto {
  @ApiProperty({ format: 'uuid', description: 'The order to bill.' })
  @IsUUID()
  orderId!: string;
}
