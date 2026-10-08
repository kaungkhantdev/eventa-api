import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/** Switch one automated message on or off (US-MSG-01). */
export class SetTemplateActiveDto {
  @ApiProperty({
    description:
      'Whether the message should send when its trigger fires. Required — there is no "toggle", because a request that flips an unknown state cannot be retried safely.',
  })
  @IsBoolean()
  active!: boolean;
}
