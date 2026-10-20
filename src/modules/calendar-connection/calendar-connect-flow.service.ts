import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { SecretCipher } from '../../common/crypto/secret-cipher';
import { DomainException } from '../../common/errors/domain.exception';
import { safeError } from '../../common/errors/safe-error';
import { PermissionsService } from '../access/permissions.service';
import type { AuthContext } from '../auth/auth.types';
import { MeetingsService } from '../meetings/meetings.service';
import { CalendarConnectionRepository } from './calendar-connection.repository';
import type { PendingState } from './calendar-connection.types';
import {
  CALENDAR_EVENTS_SCOPE,
  MANAGE_INTEGRATIONS,
} from './calendar-provider';
import type { ConnectOutcome } from './calendar-return-url';
import { formatState, parseState, sha256hex } from './calendar-state';
import type { CalendarConnectStartDto } from './dto/calendar-connection.dto';
import { type GoogleGrant, GoogleOAuthPort } from './ports/google-oauth.port';

const NOT_CONFIGURED = "Google Calendar isn't set up on this server yet.";

/** 32 random bytes as base64url: 43 characters, 256 bits. */
const RANDOM_BYTES = 32;

/** What Google echoes back to the callback — untrusted, possibly arrays. */
export interface CallbackQuery {
  code: unknown;
  state: unknown;
  error: unknown;
}

type Matched = Extract<PendingState, { kind: 'match' }>;

/** One attempt's verdict, with a fixed reason word for the log. */
interface Verdict {
  outcome: ConnectOutcome;
  reason: string;
}

const verdict = (outcome: ConnectOutcome, reason: string): Verdict => ({
  outcome,
  reason,
});

/**
 * Connecting the workspace Google Calendar (US-MTG-08): the start an Admin
 * clicks, and the callback Google's consent returns to.
 *
 * The guards, in the order the callback checks them (§9 of the contract):
 * - the `state` is opaque (`<org>.<nonce>`) and only its SHA-256 is stored,
 *   compared in constant time, ten minutes on the database clock, consumed by
 *   the first MATCHING use — a wrong nonce consumes nothing, so guessing a
 *   workspace id cannot cancel somebody's connect;
 * - the user who started it must still hold Manage integrations;
 * - PKCE S256: the verifier is made here, stored encrypted, never sent to the
 *   browser and required at the exchange, so a leaked state cannot be paired
 *   with an attacker's own code.
 *
 * Nothing on the callback path revokes: Google revokes a grant account-wide,
 * so revoking a rejected grant could cut off a good one.
 */
@Injectable()
export class CalendarConnectFlowService {
  private readonly logger = new Logger(CalendarConnectFlowService.name);

  constructor(
    private readonly repo: CalendarConnectionRepository,
    private readonly oauth: GoogleOAuthPort,
    private readonly cipher: SecretCipher,
    private readonly permissions: PermissionsService,
    private readonly meetings: MeetingsService,
  ) {}

  /** Record a pending connect and hand back Google's consent URL. */
  async start(auth: AuthContext): Promise<CalendarConnectStartDto> {
    if (!this.oauth.configured) throw DomainException.conflict(NOT_CONFIGURED);
    const nonce = randomBytes(RANDOM_BYTES).toString('base64url');
    const verifier = randomBytes(RANDOM_BYTES).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    await this.repo.beginConnect(auth.organizationId, {
      stateHash: sha256hex(nonce),
      userId: auth.userId,
      verifierCipher: this.cipher.encrypt(verifier),
    });
    const state = formatState(auth.organizationId, nonce);
    return { authorizeUrl: this.oauth.authorizeUrl(state, challenge) };
  }

  /**
   * Finish a connect from Google's callback. Never throws: whatever happens,
   * the browser is sent back to Settings with one of three words.
   */
  async complete(query: CallbackQuery): Promise<ConnectOutcome> {
    const organizationId = parseState(query.state)?.organizationId ?? null;
    try {
      const { outcome, reason } = await this.attempt(query);
      this.logger.log({ organizationId, outcome, reason }, 'Calendar connect');
      return outcome;
    } catch (err) {
      this.logger.error(
        { err: safeError(err), organizationId },
        'Calendar connect failed unexpectedly',
      );
      return 'failed';
    }
  }

  private async attempt(query: CallbackQuery): Promise<Verdict> {
    if (!this.oauth.configured) return verdict('failed', 'not_configured');
    const parsed = parseState(query.state);
    if (!parsed) return verdict('failed', 'bad_state');
    const pending = await this.repo.takePendingState(
      parsed.organizationId,
      sha256hex(parsed.nonce),
    );
    if (pending.kind !== 'match') {
      return verdict('failed', `state_${pending.kind}`);
    }
    if (!pending.live) return verdict('failed', 'state_expired');
    if (!(await this.mayManage(parsed.organizationId, pending.userId))) {
      return verdict('failed', 'not_permitted');
    }
    return this.afterConsent(parsed.organizationId, pending, query);
  }

  /** The state is ours and consumed; now read what Google says happened. */
  private async afterConsent(
    organizationId: number,
    pending: Matched,
    query: CallbackQuery,
  ): Promise<Verdict> {
    const error = asString(query.error);
    if (error === 'access_denied') return verdict('denied', 'access_denied');
    if (error) return verdict('failed', 'google_error');
    const code = asString(query.code);
    if (!code) return verdict('failed', 'no_code');
    const grant = await this.exchange(code, pending.verifierCipher);
    if (!grant) return verdict('failed', 'exchange_failed');
    if (!grant.grantedScopes.includes(CALENDAR_EVENTS_SCOPE)) {
      return verdict('denied', 'scope_withheld');
    }
    if (!grant.refreshToken) return verdict('failed', 'no_refresh_token');
    await this.repo.saveConnected(organizationId, {
      accountEmail: grant.accountEmail,
      refreshTokenCipher: this.cipher.encrypt(grant.refreshToken),
      connectedBy: pending.userId,
    });
    await this.resendUnsynced(organizationId);
    return verdict('connected', 'connected');
  }

  private async mayManage(organizationId: number, userId: string) {
    const granted = await this.permissions.getFor(organizationId, userId);
    return granted.includes(MANAGE_INTEGRATIONS);
  }

  /** Google's answer to the code, or null when it refused or was unreachable. */
  private async exchange(
    code: string,
    verifierCipher: Buffer,
  ): Promise<GoogleGrant | null> {
    try {
      return await this.oauth.exchangeCode(
        code,
        this.cipher.decrypt(verifierCipher),
      );
    } catch (err) {
      this.logger.warn({ err: safeError(err) }, 'Google code exchange failed');
      return null;
    }
  }

  /**
   * Send what was saved while disconnected (US-MTG-08 AC2 "until the calendar
   * is reconnected"). Best-effort: the connection already stands, and every
   * meeting left behind can still be sent with "Send it now".
   */
  private async resendUnsynced(organizationId: number): Promise<void> {
    try {
      await this.meetings.resyncUnsynced(organizationId);
    } catch (err) {
      this.logger.warn(
        { err: safeError(err), organizationId },
        'Re-sending unsynced meetings after connect failed',
      );
    }
  }
}

/** A query value Express may have parsed into an array is no value at all. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
