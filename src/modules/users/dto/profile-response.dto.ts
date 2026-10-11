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
  @ApiProperty({
    nullable: true,
    example: '+66812345678',
    description: 'The number Eventa texts — only ever a confirmed one',
  })
  phone!: string | null;
  @ApiProperty({
    description:
      'False until a code texted to the number has been typed back. ' +
      'While false the number is never used for texts and SMS alerts stay unavailable.',
  })
  phoneVerified!: boolean;
  @ApiProperty({
    nullable: true,
    example: '+66899999999',
    description: 'A requested number awaiting its code',
  })
  pendingPhone!: string | null;
  @ApiProperty({ nullable: true }) timezone!: string | null;
  @ApiProperty({ nullable: true, enum: ['en', 'th'] })
  locale!: string | null;
  @ApiProperty({ nullable: true }) avatarUrl!: string | null;
  @ApiProperty({ nullable: true }) city!: string | null;
  @ApiProperty({ nullable: true, example: '1995-04-12' })
  dateOfBirth!: string | null;
  @ApiProperty({ nullable: true }) bio!: string | null;
  @ApiProperty({
    nullable: true,
    example: 'THB',
    description: 'Display only — every charge still settles in THB',
  })
  displayCurrency!: string | null;
}
