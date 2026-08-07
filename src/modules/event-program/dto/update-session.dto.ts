import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional } from 'class-validator';
import { CreateSessionDto } from './create-session.dto';

/** All create fields optional, plus concurrency and the notify opt-in. */
export class UpdateSessionDto extends PartialType(CreateSessionDto) {
  @ApiPropertyOptional({
    description: 'Optimistic-concurrency token (from GET)',
  })
  @IsOptional()
  @IsInt()
  version?: number;

  @ApiPropertyOptional({
    default: false,
    description:
      'Tell attendees who added this session to their schedule (US-PROG-03). ' +
      'Omitted means no message is sent. A notice goes out only for a MATERIAL ' +
      'change — day, start, end or room — on an upcoming or live event; ' +
      'renaming a session never mails anyone.',
  })
  @IsOptional()
  @IsBoolean()
  notifyAttendees?: boolean;
}
