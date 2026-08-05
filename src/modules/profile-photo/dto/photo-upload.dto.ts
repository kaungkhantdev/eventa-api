import { ApiProperty } from '@nestjs/swagger';

/** The capability handed to the browser: where to PUT, and exactly how. */
export class PhotoUploadDto {
  @ApiProperty({
    example: 'avatars/8f1d.../7c2e....jpg',
    description: 'Send this back to confirm once the upload succeeds',
  })
  key!: string;

  @ApiProperty({ description: 'Short-lived, single-purpose upload URL' })
  uploadUrl!: string;

  @ApiProperty({
    description:
      'Headers the PUT must carry verbatim — they are covered by the signature',
    example: { 'content-type': 'image/jpeg', 'content-length': '20480' },
    additionalProperties: { type: 'string' },
  })
  headers!: Record<string, string>;

  @ApiProperty({ example: 300 })
  expiresInSeconds!: number;

  @ApiProperty({ example: 5242880 })
  maxBytes!: number;
}

/** The profile photo after a confirmed upload. */
export class PhotoDto {
  @ApiProperty({
    example: 'https://cdn.eventa.co.th/avatars/8f1d.../7c2e....jpg',
  })
  avatarUrl!: string;
}
