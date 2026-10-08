import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

/** The feed's one control: All, or Unread (US-MSG-03). */
export class NotificationFeedQueryDto {
  @ApiPropertyOptional({
    default: false,
    description:
      'Show only unread items. The counts still describe the whole feed, so the All tab keeps its number.',
  })
  @IsOptional()
  // A query string carries "true", not true. Anything else is false rather than
  // a validation error: a filter is not worth failing a page load over.
  @Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  )
  @IsBoolean()
  unreadOnly?: boolean;
}
