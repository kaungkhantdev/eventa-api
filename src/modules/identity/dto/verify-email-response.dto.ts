import { ApiProperty } from '@nestjs/swagger';

/** Result of confirming an account's email — the workspace slug to sign in with. */
export class VerifyEmailResponseDto {
  @ApiProperty({ example: true })
  verified!: boolean;

  @ApiProperty({
    example: 'acme-events',
    description: 'Workspace slug for sign-in',
  })
  orgSlug!: string;
}
