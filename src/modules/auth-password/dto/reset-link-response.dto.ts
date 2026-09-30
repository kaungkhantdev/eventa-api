import { ApiProperty } from '@nestjs/swagger';
import { userPersonaEnum } from '../../../db/schema';
import type { Persona } from '../../auth/auth.types';

/** A reset link that is still good — whose sign-in it opens (US-ACC-04). */
export class ResetLinkResponseDto {
  @ApiProperty({
    enum: userPersonaEnum.enumValues,
    example: 'admin',
    description:
      'Which sign-in the account belongs to, so the page can send them to that one once the password is set: admin → /auth/login, attendee → /portal/login.',
  })
  persona!: Persona;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Acme Events',
    description:
      'The workspace the link resets, for an organizer — one address can hold an account in several, and each gets its own link. Null for an attendee, whose account lives in the platform organization, which is never named.',
  })
  workspaceName!: string | null;
}
