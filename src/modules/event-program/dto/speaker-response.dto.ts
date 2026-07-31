import { ApiProperty } from '@nestjs/swagger';
import { speakerToneEnum } from '../../../db/schema';

/** A speaker card (mapped from the `speakers` row — never raw). */
export class SpeakerResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ example: 'Ada Lovelace' })
  name!: string;

  @ApiProperty({ nullable: true, type: String, description: 'Title/company' })
  role!: string | null;

  @ApiProperty({ nullable: true, type: String })
  email!: string | null;

  @ApiProperty({ nullable: true, type: String })
  phone!: string | null;

  @ApiProperty({ nullable: true, type: String })
  talkTitle!: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'Keynote' })
  tag!: string | null;

  @ApiProperty({ nullable: true, type: String })
  initials!: string | null;

  @ApiProperty({
    enum: speakerToneEnum.enumValues,
    nullable: true,
    type: String,
    description: 'Avatar colour',
  })
  tone!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Average feedback rating (derived)',
  })
  rating!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: 1, description: 'Optimistic-concurrency token' })
  version!: number;
}
