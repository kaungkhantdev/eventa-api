import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsInt, IsOptional } from 'class-validator';
import { CreateSpeakerDto } from './create-speaker.dto';

/** All create fields optional, plus an optimistic-concurrency token. */
export class UpdateSpeakerDto extends PartialType(CreateSpeakerDto) {
  @ApiPropertyOptional({
    description: 'Optimistic-concurrency token (from GET)',
  })
  @IsOptional()
  @IsInt()
  version?: number;
}
