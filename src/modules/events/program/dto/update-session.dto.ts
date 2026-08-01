import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsInt, IsOptional } from 'class-validator';
import { CreateSessionDto } from './create-session.dto';

/** All create fields optional, plus an optimistic-concurrency token. */
export class UpdateSessionDto extends PartialType(CreateSessionDto) {
  @ApiPropertyOptional({
    description: 'Optimistic-concurrency token (from GET)',
  })
  @IsOptional()
  @IsInt()
  version?: number;
}
