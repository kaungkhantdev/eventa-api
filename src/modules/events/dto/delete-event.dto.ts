import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional } from 'class-validator';

/** Optional optimistic-concurrency token when deleting an event. */
export class DeleteEventDto {
  @ApiPropertyOptional({
    description: 'Optimistic-concurrency token (from GET)',
  })
  @IsOptional()
  @IsInt()
  version?: number;
}
