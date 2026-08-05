import { ApiProperty } from '@nestjs/swagger';
import { eventTypeEnum } from '../../../db/schema';
import type { DiscoverBadge } from '../discover.types';

const BADGES: readonly DiscoverBadge[] = ['waitlist', 'selling_fast'];

/** One event tile in the anonymous Discover grid (US-DISC-01). */
export class EventCardDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    example: 'bangkok-tech-week',
    description: 'Address of the public event page — where the card links to',
  })
  slug!: string;

  @ApiProperty({ example: 'Bangkok Tech Week' })
  name!: string;

  @ApiProperty({ enum: eventTypeEnum.enumValues })
  type!: string;

  @ApiProperty({ example: 'Technology', nullable: true, type: String })
  categoryName!: string | null;

  @ApiProperty({
    format: 'date-time',
    description: 'UTC; render in `timezone`',
  })
  startAt!: string;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  endAt!: string | null;

  @ApiProperty({ example: 'Asia/Bangkok' })
  timezone!: string;

  @ApiProperty()
  isOnline!: boolean;

  @ApiProperty({
    example: 'QSNCC',
    nullable: true,
    type: String,
    description: 'Always null for an online event',
  })
  venueName!: string | null;

  @ApiProperty({ example: 'Bangkok', nullable: true, type: String })
  city!: string | null;

  @ApiProperty({ nullable: true, type: String })
  coverImage!: string | null;

  @ApiProperty({ example: 'Eventa Co.' })
  organizerName!: string;

  @ApiProperty({ example: 128, description: 'Confirmed admissions so far' })
  goingCount!: number;

  @ApiProperty({
    example: '฿1,200',
    nullable: true,
    type: String,
    description: "Cheapest tier still buyable, 'Free', or null when sold out",
  })
  priceFrom!: string | null;

  @ApiProperty({ enum: BADGES, nullable: true, type: String })
  badge!: DiscoverBadge | null;

  @ApiProperty({
    example: 4.8,
    nullable: true,
    type: Number,
    description: 'Average attendee rating; null until the event is reviewed',
  })
  rating!: number | null;
}
