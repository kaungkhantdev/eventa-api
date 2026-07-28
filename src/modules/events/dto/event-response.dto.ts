import { ApiProperty } from '@nestjs/swagger';

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

  @ApiProperty({ example: 'Conference' })
  type!: string;

  @ApiProperty({ example: 'draft' })
  status!: string;

  @ApiProperty({ example: 'active' })
  bucket!: string;

  @ApiProperty({ example: 'private' })
  visibility!: string;

  @ApiProperty({ format: 'date-time' })
  startAt!: string;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  endAt!: string | null;

  @ApiProperty({ example: 'Asia/Bangkok' })
  timezone!: string;

  @ApiProperty()
  isOnline!: boolean;

  @ApiProperty({ example: 'ga' })
  seatingMode!: string;

  @ApiProperty()
  organizerName!: string;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  publishedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
