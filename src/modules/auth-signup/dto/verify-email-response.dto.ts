import { ApiProperty } from '@nestjs/swagger';

/** Result of confirming an account's email — where, and as whom, to sign in. */
export class VerifyEmailResponseDto {
  @ApiProperty({ example: true })
  verified!: boolean;

  @ApiProperty({
    example: 'acme-events',
    description:
      'Workspace slug for organizer sign-in. For an attendee this is the platform organization and must NOT be sent to /auth/login — attendee sign-in refuses an orgSlug.',
  })
  orgSlug!: string;

  @ApiProperty({
    enum: ['admin', 'attendee'],
    example: 'admin',
    description:
      'Which sign-in page the confirmed account belongs to (US-DISC-08).',
  })
  persona!: 'admin' | 'attendee';
}
