import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsInt, IsOptional } from 'class-validator';
import { CreateTicketDto } from './create-ticket.dto';

/** All create fields optional, plus an optimistic-concurrency token. */
export class UpdateTicketDto extends PartialType(CreateTicketDto) {
  @ApiPropertyOptional({
    description: 'Optimistic-concurrency token (from GET)',
  })
  @IsOptional()
  @IsInt()
  version?: number;
}
