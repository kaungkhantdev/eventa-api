import { ApiProperty } from '@nestjs/swagger';

/** A member's own profile (US-SET-01). */
export class ProfileResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'The address you sign in with' })
  email!: string;
  @ApiProperty({
    nullable: true,
    description: 'A requested address awaiting confirmation',
  })
  pendingEmail!: string | null;
  @ApiProperty({ description: 'False while an email change is unconfirmed' })
  emailVerified!: boolean;
  @ApiProperty({ nullable: true }) phone!: string | null;
  @ApiProperty({ nullable: true }) timezone!: string | null;
  @ApiProperty({ nullable: true, enum: ['en', 'th'] })
  locale!: string | null;
  @ApiProperty({ nullable: true }) avatarUrl!: string | null;
}
