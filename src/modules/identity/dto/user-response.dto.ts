import { ApiProperty } from '@nestjs/swagger';
import type { OrganizationRow, UserRow } from '../auth.types';

export class OrganizationSummaryDto {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ example: 'THB' }) currency!: string;
  @ApiProperty({ example: 'Asia/Bangkok' }) timezone!: string;
  @ApiProperty({ enum: ['en', 'th'] }) locale!: 'en' | 'th';
}

/** The authenticated user's profile — returned by /auth/login and /auth/me. */
export class MeResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: ['admin', 'attendee'] }) persona!: 'admin' | 'attendee';
  @ApiProperty({ enum: ['Active', 'Invited', 'Suspended'] })
  status!: 'Active' | 'Invited' | 'Suspended';
  @ApiProperty() twoFactorEnabled!: boolean;
  @ApiProperty({ type: OrganizationSummaryDto })
  organization!: OrganizationSummaryDto;
  @ApiProperty({ type: [String], description: 'Granted permission keys' })
  permissions!: string[];
}

export function toMeResponse(
  user: UserRow,
  org: OrganizationRow,
  permissions: string[],
): MeResponseDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    persona: user.persona,
    status: user.status,
    twoFactorEnabled: user.twoFactorEnabled,
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      currency: org.currency,
      timezone: org.timezone,
      locale: org.locale,
    },
    permissions,
  };
}
