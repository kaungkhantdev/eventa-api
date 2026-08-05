import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, MaxLength, Min } from 'class-validator';
import { ALLOWED_CONTENT_TYPES } from '../profile-photo.types';

/** Keys are issued by the server, but they still arrive as input on confirm. */
const MAX_KEY_LENGTH = 200;

/** Ask for an upload URL (US-DISC-11). The bytes go straight to storage. */
export class RequestPhotoUploadDto {
  @ApiProperty({ enum: ALLOWED_CONTENT_TYPES, example: 'image/jpeg' })
  // Enforced, not merely documented — the service's allow-list is the same list.
  @IsIn(ALLOWED_CONTENT_TYPES)
  contentType!: string;

  @ApiProperty({
    example: 20480,
    description: 'Exact byte length — it is signed into the URL',
  })
  @IsInt()
  @Min(1)
  byteSize!: number;
}

/** Confirm an upload the server issued a key for. */
export class ConfirmPhotoDto {
  @ApiProperty({ example: 'uploads/8f1d.../7c2e....jpg' })
  @IsString()
  @MaxLength(MAX_KEY_LENGTH)
  key!: string;
}
