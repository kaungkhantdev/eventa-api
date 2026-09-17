import { ApiProperty } from '@nestjs/swagger';
import { FEED_BUCKETS, type FeedBucket } from '../notification-grouping';
import { FEED_KINDS, type FeedKind } from '../ports/notification-feed.types';

/**
 * One thing that happened (US-MSG-03).
 *
 * Facts, not a sentence. The feed is bilingual EN/TH, so the wording is composed
 * at the edge from `kind` and these fields — a title written here would be
 * English for everybody.
 */
export class NotificationItemDto {
  @ApiProperty({
    example: 'order:6f1c…',
    description: 'Stable across requests: the source and its row.',
  })
  id!: string;

  @ApiProperty({
    enum: FEED_KINDS,
    description:
      'What happened. `alert` is a declined payment — the only kind that asks for action.',
  })
  kind!: FeedKind;

  @ApiProperty({ format: 'date-time', description: 'When it happened, UTC.' })
  at!: string;

  @ApiProperty({
    description: 'Whether it arrived after this member last read.',
  })
  unread!: boolean;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  eventId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Tech Summit 2026' })
  eventName!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Who it concerns — the buyer, the payer. Null where nobody is named.',
  })
  personName!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Integer satang. Null where the item is not about money — never a stand-in zero.',
  })
  amountSatang!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  seats!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The payout’s own reference, for the one kind that has one.',
  })
  reference!: string | null;
}

export class NotificationGroupDto {
  @ApiProperty({
    enum: FEED_BUCKETS,
    description:
      'Which stretch of time the group covers. The label is the reader’s own language.',
  })
  bucket!: FeedBucket;

  @ApiProperty({
    description: 'Open by default; the rest sit behind “show older activity”.',
  })
  recent!: boolean;

  @ApiProperty({ type: [NotificationItemDto] })
  items!: NotificationItemDto[];
}

export class NotificationCountsDto {
  @ApiProperty({
    description:
      'Everything in the window this member may see — unchanged by the unread filter.',
  })
  all!: number;

  @ApiProperty() unread!: number;
}

export class NotificationFeedDto {
  @ApiProperty({ type: NotificationCountsDto })
  counts!: NotificationCountsDto;

  @ApiProperty({
    type: [NotificationGroupDto],
    description: 'Newest group first; a group with nothing in it is omitted.',
  })
  groups!: NotificationGroupDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date-time',
    description: 'When this member last marked the feed read; null if never.',
  })
  readAt!: string | null;
}

export class NotificationsReadDto {
  @ApiProperty({ format: 'date-time' })
  readAt!: string;

  @ApiProperty({
    example: 0,
    description: 'Always zero — everything is now read.',
  })
  unread!: number;
}
