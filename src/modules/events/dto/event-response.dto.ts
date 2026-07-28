import { ApiProperty } from '@nestjs/swagger';
import {
  eventBucketEnum,
  eventStatusEnum,
  eventTypeEnum,
  seatingModeEnum,
  visibilityEnum,
} from '../../../db/schema';

/** Response shape for a single event (mapped from the Drizzle row — never raw). */
export class EventResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'tech-conference-2026' })
  slug!: string;

  @ApiProperty({ example: 'Tech Conference 2026' })
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ enum: eventTypeEnum.enumValues, example: 'Conference' })
  type!: string;

  @ApiProperty({ enum: eventStatusEnum.enumValues, example: 'draft' })
  status!: string;

  @ApiProperty({ enum: eventBucketEnum.enumValues, example: 'active' })
  bucket!: string;

  @ApiProperty({ enum: visibilityEnum.enumValues, example: 'private' })
  visibility!: string;

  @ApiProperty({ format: 'date-time' })
  startAt!: string;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  endAt!: string | null;

  @ApiProperty({ example: 'Asia/Bangkok' })
  timezone!: string;

  @ApiProperty()
  isOnline!: boolean;

  @ApiProperty({ enum: seatingModeEnum.enumValues, example: 'ga' })
  seatingMode!: string;

  @ApiProperty()
  organizerName!: string;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  publishedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
