import { ApiProperty } from '@nestjs/swagger';
import { sessionColorEnum, sessionTypeEnum } from '../../../../db/schema';

class SessionSpeakerDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Ada Lovelace' })
  name!: string;
}

/** An agenda session (mapped from the `sessions` row + its speaker links). */
export class SessionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ example: 1, description: '1-based day index' })
  day!: number;

  @ApiProperty({ example: '09:00:00' })
  startTime!: string;

  @ApiProperty({ nullable: true, type: String, example: '10:00:00' })
  endTime!: string | null;

  @ApiProperty({ example: 'Opening Keynote' })
  title!: string;

  @ApiProperty({ enum: sessionTypeEnum.enumValues, example: 'Keynote' })
  type!: string;

  @ApiProperty({ nullable: true, type: String, example: 'Main Hall' })
  room!: string | null;

  @ApiProperty({
    enum: sessionColorEnum.enumValues,
    nullable: true,
    type: String,
  })
  color!: string | null;

  @ApiProperty({ example: 0, description: 'Ordering within the day' })
  sortOrder!: number;

  @ApiProperty({ type: [SessionSpeakerDto] })
  speakers!: SessionSpeakerDto[];

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Set when this write overlaps another same-room session (not blocking)',
  })
  warning!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: 1, description: 'Optimistic-concurrency token' })
  version!: number;
}
