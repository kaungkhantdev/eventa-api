import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../../common/time/clock';
import { DomainException } from '../../common/errors/domain.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  UQ_ORGANIZATIONS_NAME,
  isUniqueViolation,
} from '../../common/errors/unique-violation';
import { slugify } from '../../common/util/slugify';
import type { Env } from '../../config/env.validation';
import { Persona } from '../auth/auth.types';
import { OutboxPort } from '../platform/outbox.port';
import { RegisterResponseDto } from './dto/register-response.dto';
import { VerifyEmailResponseDto } from './dto/verify-email-response.dto';
import { emailVerificationRequestedEvent } from './events/email-verification-requested.event';
import { PasswordService } from '../auth-password/auth-password.service';
import { SignupRepository } from './auth-signup.repository';
import { ResendThrottleService } from './resend-throttle.service';
import { TokenService } from '../auth/token.service';

const CHECK_INBOX_MESSAGE =
  'Check your inbox to confirm your email and finish signing up.';
const INVALID_LINK_MESSAGE =
  'This confirmation link is invalid or has expired. Request a new one.';
const NO_ATTENDEE_WORKSPACE_MESSAGE =
  "An attendee account doesn't have a workspace — leave organizationName out.";
const NAME_TAKEN_MESSAGE = 'That workspace name is already taken. Try another.';
const NO_PLATFORM_ORG_MESSAGE =
  'Attendee accounts are unavailable right now. Please try again later.';

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  organizationName?: string;
  /** Which realm the sign-up is for. Absent means organizer, as it always did. */
  persona?: Persona;
}

/** Sign-up + email confirmation for both audiences (US-ACC-01, US-DISC-08). */
@Injectable()
export class SignupService {
  private readonly publicWebUrl: string;

  constructor(
    private readonly repo: SignupRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
    private readonly throttle: ResendThrottleService,
    config: ConfigService<Env, true>,
  ) {
    this.publicWebUrl = config.getOrThrow('PUBLIC_WEB_URL', { infer: true });
  }

  /**
   * Create an account and send a confirmation email. Always returns the same
   * neutral acknowledgement — a taken email is never revealed and no duplicate
   * account is created (US-ACC-01).
   *
   * Which realm it lands in is told, never inferred: an organizer gets a
   * workspace they own, an attendee gets one user in the platform organization
   * (US-DISC-08). The two are separate accounts even on the same address, so
   * one person may run events and buy a ticket without either blocking the
   * other.
   */
  async register(input: RegisterInput): Promise<RegisterResponseDto> {
    if ((input.persona ?? Persona.Admin) === Persona.Attendee) {
      return this.registerAttendee(input);
    }
    if (await this.repo.organizerEmailExists(input.email)) {
      return { message: CHECK_INBOX_MESSAGE };
    }
    // Only a name somebody actually typed can be refused for being taken. The
    // fallback below is invented here, so it is made unique instead — exactly
    // as the slug always has been.
    if (
      input.organizationName &&
      (await this.repo.nameTaken(input.organizationName))
    ) {
      throw DomainException.conflict(NAME_TAKEN_MESSAGE);
    }
    const organizationName =
      input.organizationName ?? `${input.name}’s Workspace`;
    const slug = await this.repo.uniqueSlug(
      slugify(organizationName, 'workspace'),
    );
    const passwordHash = await this.passwords.hash(input.password);
    const created = await this.bootstrapOrRefuse({
      organizationName,
      slug,
      name: input.name,
      email: input.email,
      passwordHash,
    });
    const { organizationId, userId } = created;
    await this.resendVerification({
      organizationId,
      userId,
      name: input.name,
      email: input.email,
    });
    return { message: CHECK_INBOX_MESSAGE };
  }

  /**
   * Create the workspace, or turn the index's refusal into the same answer the
   * check above would have given.
   *
   * Between that check and this write, somebody else can take the name. The
   * index is what actually stops the second one; without this it would surface
   * as a 500 and read as a bug rather than as a name already spoken for.
   */
  private async bootstrapOrRefuse(
    input: Parameters<SignupRepository['bootstrapWorkspace']>[0],
  ): Promise<Awaited<ReturnType<SignupRepository['bootstrapWorkspace']>>> {
    try {
      return await this.repo.bootstrapWorkspace(input);
    } catch (cause) {
      if (isUniqueViolation(cause, UQ_ORGANIZATIONS_NAME)) {
        throw DomainException.conflict(NAME_TAKEN_MESSAGE);
      }
      throw cause;
    }
  }

  /**
   * The attendee branch: one user in the platform organization, no workspace.
   *
   * Naming a workspace is refused rather than ignored, matching attendee
   * sign-in — a client that sends one is confused about which realm it is in,
   * and should hear so.
   */
  private async registerAttendee(
    input: RegisterInput,
  ): Promise<RegisterResponseDto> {
    if (input.organizationName) {
      throw DomainException.validation(NO_ATTENDEE_WORKSPACE_MESSAGE);
    }
    if (await this.repo.attendeeEmailExists(input.email)) {
      return { message: CHECK_INBOX_MESSAGE };
    }
    const passwordHash = await this.passwords.hash(input.password);
    const created = await this.repo.createAttendeeAccount({
      name: input.name,
      email: input.email,
      passwordHash,
    });
    // Seeded by migration 0026, so its absence is a broken deployment. Said
    // out loud rather than answered with a cheerful "check your inbox" for an
    // account that was never created.
    if (!created) {
      throw new DomainException(
        ErrorCode.INTERNAL_ERROR,
        NO_PLATFORM_ORG_MESSAGE,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    await this.resendVerification({
      organizationId: created.organizationId,
      userId: created.userId,
      name: input.name,
      email: input.email,
    });
    return { message: CHECK_INBOX_MESSAGE };
  }

  /**
   * Confirm an account's email from its link.
   *
   * Reports the persona as well as the slug: the two audiences sign in at
   * different pages, and only an organizer's slug is ever typed into a
   * workspace field — attendee sign-in refuses one outright.
   */
  async verifyEmail(token: string): Promise<VerifyEmailResponseDto> {
    const claims = await this.decodeToken(token);
    const activated = await this.repo.activateEmail(claims.sub, claims.org);
    if (!activated) throw DomainException.validation(INVALID_LINK_MESSAGE);
    return {
      verified: true,
      orgSlug: activated.orgSlug,
      persona: activated.persona,
    };
  }

  /**
   * Send the confirmation link again (US-ACC-01).
   *
   * Mail goes missing — a typo'd address, a spam folder, an SMTP outage — and
   * without this the only way back is to sign up again, which the API refuses
   * because the account already exists. That is a dead end for somebody who did
   * everything right.
   *
   * The answer is the same sentence whichever branch runs. The endpoint is
   * public and the address is typed by whoever is asking, so a response that
   * differed for a real account would be an account-existence oracle.
   */
  async requestResend(input: {
    email: string;
    persona?: Persona;
  }): Promise<RegisterResponseDto> {
    const persona = input.persona ?? Persona.Admin;
    const identity = `${persona}|${input.email.toLowerCase()}`;

    await this.throttle.assertAllowed(identity);
    // Started before the lookup, and whether or not anything is sent: a
    // cool-off that only applied to real accounts would answer the question
    // the response refuses to.
    await this.throttle.remember(identity);

    const pending = await this.repo.pendingVerification(input.email, persona);
    if (pending) await this.resendVerification(pending);

    return { message: CHECK_INBOX_MESSAGE };
  }

  /** Sign a fresh verify token and enqueue the confirmation email (sign-up + resend). */
  async resendVerification(params: {
    organizationId: number;
    userId: string;
    name: string;
    email: string;
  }): Promise<void> {
    const token = await this.tokens.signEmailVerification({
      userId: params.userId,
      organizationId: params.organizationId,
    });
    await this.outbox.enqueue(
      emailVerificationRequestedEvent({
        organizationId: params.organizationId,
        userId: params.userId,
        name: params.name,
        email: params.email,
        verifyUrl: `${this.publicWebUrl}/verify-email?token=${token}`,
        occurredAt: this.clock.now().toISOString(),
      }),
    );
  }

  private async decodeToken(
    token: string,
  ): Promise<{ sub: string; org: number }> {
    try {
      return await this.tokens.verifyEmailVerification(token);
    } catch {
      throw DomainException.validation(INVALID_LINK_MESSAGE);
    }
  }
}
