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

/**
 * Claims of the short-lived token bridging password and code (US-ACC-05 /
 * US-DISC-12). It proves "this person's password checked out moments ago" and
 * nothing more — it opens no session and no API route.
 */
export interface TwoFactorChallengeClaims {
  sub: string; // userId
  org: number; // organizationId
  persona: Persona;
  /** Remember-me carried from the password step, honoured at completion. */
  rem: boolean;
  typ: 'twofa';
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

/**
 * Claims of the link that lets a booking's buyer create their account from it
 * (US-DISC-15). It is emailed to the booking's address and nowhere else, so
 * holding it is the proof that the person choosing a password reads that inbox
 * — which is why it names the address it was sent to, and why nothing else
 * this service signs may stand in for it.
 */
export interface BookingClaimClaims {
  sub: string; // orderId
  email: string; // the booking's buyer email the link was sent to
  typ: 'booking_claim';
  exp: number; // seconds since the epoch — every claim link expires
}
