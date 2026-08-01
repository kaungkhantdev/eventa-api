import { ApiProperty } from '@nestjs/swagger';

/** One device where the account is signed in (US-SET-04). */
export class SessionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() device!: string;
  @ApiProperty({ nullable: true, description: 'Rough location cue' })
  ipAddress!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) signedInAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: string;
  @ApiProperty({
    description: 'The device making this request — no sign-out control',
  })
  isCurrent!: boolean;
}
