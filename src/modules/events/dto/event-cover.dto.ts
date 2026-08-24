import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, MaxLength, Min } from 'class-validator';
import { ALLOWED_CONTENT_TYPES } from '../../profile-photo/profile-photo.types';

/** Keys are issued by the server, but they still arrive as input on confirm. */
const MAX_KEY_LENGTH = 200;

/** Ask for an upload URL. The bytes go straight to storage, never through here. */
export class RequestCoverUploadDto {
  @ApiProperty({ enum: ALLOWED_CONTENT_TYPES, example: 'image/jpeg' })
  // Enforced, not merely documented — the service's allow-list is the same list.
  @IsIn(ALLOWED_CONTENT_TYPES)
  contentType!: string;

  @ApiProperty({
    example: 240000,
    description: 'Exact byte length — it is signed into the URL',
  })
  @IsInt()
  @Min(1)
  byteSize!: number;
}

/** Confirm an upload the server issued a key for. */
export class ConfirmCoverDto {
  @ApiProperty({ example: 'staging/org/7/event-covers/7c2e….jpg' })
  @IsString()
  @MaxLength(MAX_KEY_LENGTH)
  key!: string;
}

/** The capability handed to the browser: where to PUT, and exactly how. */
export class CoverUploadDto {
  @ApiProperty({
    description: 'Send this back to confirm once the PUT succeeds',
  })
  key!: string;

  @ApiProperty({ description: 'Short-lived, single-purpose upload URL' })
  uploadUrl!: string;

  @ApiProperty({
    description:
      'Headers the PUT must carry verbatim — they are covered by the signature',
    additionalProperties: { type: 'string' },
  })
  headers!: Record<string, string>;

  @ApiProperty({ example: 300 })
  expiresInSeconds!: number;

  @ApiProperty({ example: 5242880 })
  maxBytes!: number;
}

/**
 * The confirmed image's URL — for the form to carry into `coverImage` when the
 * event itself is saved. Nothing is written to an event here.
 */
export class CoverDto {
  @ApiProperty({
    example: 'https://cdn.eventa.co.th/org/7/event-covers/7c2e….jpg',
  })
  coverImage!: string;
}
