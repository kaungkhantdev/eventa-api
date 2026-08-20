import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, MaxLength, Min } from 'class-validator';
import { ALLOWED_CONTENT_TYPES } from '../../profile-photo/profile-photo.types';

/** Keys are issued by the server, but they still arrive as input on confirm. */
const MAX_KEY_LENGTH = 200;

/** Ask for an upload URL (US-SET-07). The bytes go straight to storage. */
export class RequestLogoUploadDto {
  @ApiProperty({ enum: ALLOWED_CONTENT_TYPES, example: 'image/png' })
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
export class ConfirmLogoDto {
  @ApiProperty({ example: 'uploads/org/7/7c2e....png' })
  @IsString()
  @MaxLength(MAX_KEY_LENGTH)
  key!: string;
}

/** The capability handed to the browser: where to PUT, and exactly how. */
export class LogoUploadDto {
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

/** The workspace logo after a confirmed upload. */
export class LogoDto {
  @ApiProperty({ example: 'https://cdn.eventa.co.th/logos/7/7c2e....png' })
  logoUrl!: string;
}
