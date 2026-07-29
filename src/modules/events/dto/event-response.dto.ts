import { ApiProperty } from '@nestjs/swagger';
import {
  eventBucketEnum,
  eventStatusEnum,
  eventTypeEnum,
  seatingModeEnum,
  templateIdEnum,
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

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Workspace category id',
  })
  categoryId!: number | null;

  @ApiProperty({ format: 'date-time' })
  startAt!: string;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  endAt!: string | null;

  @ApiProperty({ example: 'Asia/Bangkok' })
  timezone!: string;

  @ApiProperty({ nullable: true, type: String })
  venueName!: string | null;

  @ApiProperty({ nullable: true, type: String })
  venueAddress!: string | null;

  @ApiProperty({ nullable: true, type: String })
  city!: string | null;

  @ApiProperty()
  isOnline!: boolean;

  @ApiProperty({ nullable: true, type: String })
  onlineNote!: string | null;

  @ApiProperty({ enum: seatingModeEnum.enumValues, example: 'ga' })
  seatingMode!: string;

  @ApiProperty({ nullable: true, type: Number })
  capacity!: number | null;

  @ApiProperty({ nullable: true, type: String })
  coverImage!: string | null;

  @ApiProperty({ nullable: true, type: String })
  accentColor!: string | null;

  @ApiProperty({ nullable: true, type: String })
  contactEmail!: string | null;

  @ApiProperty()
  organizerName!: string;

  @ApiProperty({
    enum: templateIdEnum.enumValues,
    nullable: true,
    type: String,
    description: 'Chosen public landing-page template (null until picked)',
  })
  landingTemplateId!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  publishedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: 1, description: 'Optimistic-concurrency token' })
  version!: number;
}
