import type { organizations, users } from '../../db/schema';

/** The two audiences; a login belongs to exactly one (ADR-8). */
export const Persona = {
  Admin: 'admin',
  Attendee: 'attendee',
} as const;
export type Persona = (typeof Persona)[keyof typeof Persona];

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

/** Claims of a workspace-invite token (accepted to set a password + activate). */
export interface InviteTokenClaims {
  sub: string; // userId
  org: number; // organizationId
  mid: number; // membership id
  typ: 'invite';
}

/** Claims of an email-confirmation token (opened to activate a new account). */
export interface EmailVerificationClaims {
  sub: string; // userId
  org: number; // organizationId
  typ: 'verify_email';
}

/**
 * Claims of an email-CHANGE confirmation link (US-SET-01). Carries the requested
 * address so opening the link promotes exactly that one — the current sign-in
 * email keeps working until then.
 */
export interface EmailChangeClaims {
  sub: string; // userId
  org: number; // organizationId
  email: string; // the requested new address
  typ: 'change_email';
}

/**
 * Claims of a password-reset token. `pv` is a fingerprint of the current password
 * hash — once the password changes (a successful reset, or any other change) the
 * fingerprint no longer matches, so the link is single-use and self-invalidating.
 */
export interface PasswordResetClaims {
  sub: string; // userId
  org: number; // organizationId
  pv: string; // password fingerprint
  typ: 'reset_password';
}
