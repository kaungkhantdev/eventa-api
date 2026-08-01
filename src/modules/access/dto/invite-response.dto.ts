import { ApiProperty } from '@nestjs/swagger';
import { MemberResponseDto } from './member-response.dto';

/** Result of inviting a teammate: the created (Invited) member + the invite token. */
export class InviteResponseDto {
  @ApiProperty({ type: MemberResponseDto })
  member!: MemberResponseDto;

  @ApiProperty({
    description:
      'Single-use invite token — accept via POST /auth/accept-invite to set a ' +
      'password and activate. Returned here for now; emailed once the mail ' +
      'provider is wired up.',
  })
  inviteToken!: string;
}
