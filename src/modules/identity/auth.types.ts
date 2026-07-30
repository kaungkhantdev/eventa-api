import type { organizations, users } from '../../db/schema';

export type Persona = 'admin' | 'attendee';

export type UserRow = typeof users.$inferSelect;
export type OrganizationRow = typeof organizations.$inferSelect;

/** Resolved principal + tenant, decoded from the access token by JwtAuthGuard. */
export interface AuthContext {
  userId: string;
  organizationId: number;
  /** auth_sessions.id — the revocable refresh session this token belongs to. */
  sessionId: string;
  persona: Persona;
}

interface BaseClaims {
  sub: string; // userId
  org: number; // organizationId
  sid: string; // auth_sessions.id
  persona: Persona;
}

export interface AccessTokenClaims extends BaseClaims {
  typ: 'access';
}

export interface RefreshTokenClaims extends BaseClaims {
  typ: 'refresh';
}
