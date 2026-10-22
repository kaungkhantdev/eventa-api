import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { SecretCipher } from '../../common/crypto/secret-cipher';
import type { PermissionsService } from '../access/permissions.service';
import type { AuthContext } from '../auth/auth.types';
import type { MeetingsService } from '../meetings/meetings.service';
import { CalendarConnectFlowService } from './calendar-connect-flow.service';
import type {
  BeginConnectInput,
  CalendarConnectionRepository,
  SaveConnectedInput,
} from './calendar-connection.repository';
import type { PendingState } from './calendar-connection.types';
import { formatState, sha256hex } from './calendar-state';
import {
  type GoogleGrant,
  GoogleOAuthError,
  GoogleOAuthPort,
} from './ports/google-oauth.port';
import { CALENDAR_SCOPES } from '../../common/constants/calendar-connection.constants';

const KEY = Buffer.alloc(32, 9).toString('base64');
const ORG = 7;
const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const REFRESH = '1//plaintext-refresh-token';
const CODE = 'google-auth-code';

const auth: AuthContext = {
  userId: ADMIN,
  organizationId: ORG,
  sessionId: 's-1',
  persona: 'admin',
};

/**
 * The repository's contract, in memory: one pending connect per workspace,
 * consumed only by a MATCHING hash. The SQL itself is proven by the e2e.
 */
class MemoryRepo {
  pending = new Map<number, BeginConnectInput & { live: boolean }>();
  saved: { org: number; input: SaveConnectedInput }[] = [];
  calls: unknown[] = [];

  beginConnect = jest.fn((org: number, input: BeginConnectInput) => {
    this.calls.push(input);
    this.pending.set(org, { ...input, live: true });
    return Promise.resolve();
  });

  takePendingState = jest.fn(
    (org: number, stateHash: string): Promise<PendingState> => {
      this.calls.push(stateHash);
      const held = this.pending.get(org);
      if (!held) return Promise.resolve({ kind: 'none' });
      if (held.stateHash !== stateHash) {
        return Promise.resolve({ kind: 'mismatch' });
      }
      this.pending.delete(org);
      return Promise.resolve({
        kind: 'match',
        userId: held.userId,
        verifierCipher: held.verifierCipher,
        live: held.live,
      });
    },
  );

  saveConnected = jest.fn((org: number, input: SaveConnectedInput) => {
    this.calls.push(input);
    this.saved.push({ org, input });
    return Promise.resolve();
  });
}

class StubOAuth extends GoogleOAuthPort {
  configured = true;
  authorizeUrl = jest.fn(
    (state: string, challenge: string) =>
      `https://accounts.google.test/auth?state=${encodeURIComponent(state)}&code_challenge=${challenge}`,
  );
  exchangeCode = jest
    .fn<Promise<GoogleGrant>, [string, string]>()
    .mockImplementation(() =>
      Promise.resolve({
        refreshToken: REFRESH,
        accountEmail: 'events@acme.co.th',
        grantedScopes: [...CALENDAR_SCOPES],
      }),
    );
  revoke = jest.fn(() => Promise.resolve());
}

describe('CalendarConnectFlowService (US-MTG-08)', () => {
  let cipher: SecretCipher;
  let repo: MemoryRepo;
  let oauth: StubOAuth;
  let granted: Record<string, string[]>;
  let meetings: { resyncUnsynced: jest.Mock };
  let flow: CalendarConnectFlowService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    cipher = new SecretCipher({ getOrThrow: () => KEY } as never);
    repo = new MemoryRepo();
    oauth = new StubOAuth();
    granted = { [ADMIN]: ['setIntegrations', 'setSettings'] };
    meetings = { resyncUnsynced: jest.fn().mockResolvedValue(2) };
    const permissions = {
      getFor: jest.fn((_org: number, userId: string) =>
        Promise.resolve(granted[userId] ?? []),
      ),
    } as unknown as PermissionsService;
    flow = new CalendarConnectFlowService(
      repo as unknown as CalendarConnectionRepository,
      oauth,
      cipher,
      permissions,
      meetings as unknown as MeetingsService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  /** Start a connect and return the state Google would echo back. */
  const started = async (): Promise<string> => {
    const { authorizeUrl } = await flow.start(auth);
    return new URL(authorizeUrl).searchParams.get('state') ?? '';
  };

  describe('start', () => {
    it('refuses when the server has no Google client, saying so', async () => {
      oauth.configured = false;
      await expect(flow.start(auth)).rejects.toMatchObject({
        status: 409,
        message: "Google Calendar isn't set up on this server yet.",
      });
      expect(repo.beginConnect).not.toHaveBeenCalled();
    });

    it('stores the hash of the nonce, never the nonce', async () => {
      const state = await started();
      const nonce = state.split('.')[1];
      const [, input] = repo.beginConnect.mock.calls[0];
      expect(input.stateHash).toBe(
        createHash('sha256').update(nonce).digest('hex'),
      );
      expect(JSON.stringify(repo.calls)).not.toContain(nonce);
    });

    it('stores the PKCE verifier encrypted, matching the challenge sent to Google', async () => {
      await started();
      const [, input] = repo.beginConnect.mock.calls[0];
      const [, challenge] = oauth.authorizeUrl.mock.calls[0];
      const verifier = cipher.decrypt(input.verifierCipher);
      expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
        challenge,
      );
      expect(input.verifierCipher.toString('utf8')).not.toContain(verifier);
    });

    it('records who started it, outside the state', async () => {
      const state = await started();
      expect(repo.beginConnect.mock.calls[0][1].userId).toBe(ADMIN);
      expect(state).toMatch(/^7\.[A-Za-z0-9_-]{43}$/);
      expect(state).not.toContain(ADMIN);
    });

    it('makes a fresh nonce and verifier every time', async () => {
      const first = await started();
      const second = await started();
      expect(second).not.toBe(first);
      expect(oauth.authorizeUrl.mock.calls[1][1]).not.toBe(
        oauth.authorizeUrl.mock.calls[0][1],
      );
    });
  });

  describe('complete', () => {
    it('connects: stores the grant encrypted, by who started it, and re-sends unsynced meetings', async () => {
      const state = await started();
      await expect(
        flow.complete({ code: CODE, state, error: undefined }),
      ).resolves.toBe('connected');
      const [{ org, input }] = repo.saved;
      expect(org).toBe(ORG);
      expect(input.connectedBy).toBe(ADMIN);
      expect(input.accountEmail).toBe('events@acme.co.th');
      expect(cipher.decrypt(input.refreshTokenCipher)).toBe(REFRESH);
      expect(meetings.resyncUnsynced).toHaveBeenCalledWith(ORG);
    });

    it('hands Google the decrypted verifier with the code', async () => {
      const state = await started();
      const verifier = cipher.decrypt(
        repo.beginConnect.mock.calls[0][1].verifierCipher,
      );
      await flow.complete({ code: CODE, state, error: undefined });
      expect(oauth.exchangeCode).toHaveBeenCalledWith(CODE, verifier);
    });

    it('never gives the repository the plaintext token', async () => {
      const state = await started();
      await flow.complete({ code: CODE, state, error: undefined });
      expect(JSON.stringify(repo.calls)).not.toContain(REFRESH);
      expect(
        repo.saved[0].input.refreshTokenCipher.toString('utf8'),
      ).not.toContain(REFRESH);
    });

    it('fails when the server has no Google client', async () => {
      const state = await started();
      oauth.configured = false;
      await expect(
        flow.complete({ code: CODE, state, error: undefined }),
      ).resolves.toBe('failed');
      expect(repo.takePendingState).not.toHaveBeenCalled();
    });

    it.each([
      ['a malformed state', 'not-a-state'],
      ['a missing state', undefined],
      ['a repeated state', ['7.a', '7.b']],
    ])('fails on %s without touching the store', async (_label, state) => {
      await expect(
        flow.complete({ code: CODE, state, error: undefined }),
      ).resolves.toBe('failed');
      expect(repo.takePendingState).not.toHaveBeenCalled();
    });

    it('fails when nothing is pending', async () => {
      const state = formatState(ORG, 'x'.repeat(43));
      await expect(
        flow.complete({ code: CODE, state, error: undefined }),
      ).resolves.toBe('failed');
    });

    it('looks the pending connect up by the hash of the nonce', async () => {
      const state = await started();
      await flow.complete({ code: CODE, state, error: undefined });
      expect(repo.takePendingState).toHaveBeenCalledWith(
        ORG,
        sha256hex(state.split('.')[1]),
      );
    });

    it('fails a wrong nonce WITHOUT cancelling the real connect in progress', async () => {
      const state = await started();
      await expect(
        flow.complete({
          code: CODE,
          state: formatState(ORG, 'y'.repeat(43)),
          error: undefined,
        }),
      ).resolves.toBe('failed');
      await expect(
        flow.complete({ code: CODE, state, error: undefined }),
      ).resolves.toBe('connected');
    });

    it('is single-use: a replayed state fails', async () => {
      const state = await started();
      await flow.complete({ code: CODE, state, error: undefined });
      await expect(
        flow.complete({ code: CODE, state, error: undefined }),
      ).resolves.toBe('failed');
      expect(oauth.exchangeCode).toHaveBeenCalledTimes(1);
    });

    it('fails a state past its ten minutes, consuming it', async () => {
      const state = await started();
      repo.pending.get(ORG)!.live = false;
      await expect(
        flow.complete({ code: CODE, state, error: undefined }),
      ).resolves.toBe('failed');
      expect(repo.pending.has(ORG)).toBe(false);
      expect(oauth.exchangeCode).not.toHaveBeenCalled();
    });

    it('fails when the starter lost Manage integrations before the callback', async () => {
      const state = await started();
      granted[ADMIN] = ['regView'];
      await expect(
        flow.complete({ code: CODE, state, error: undefined }),
      ).resolves.toBe('failed');
      expect(oauth.exchangeCode).not.toHaveBeenCalled();
    });

    it('fails when the starter is no longer a member at all', async () => {
      const state = await started();
      delete granted[ADMIN];
      await expect(
        flow.complete({ code: CODE, state, error: undefined }),
      ).resolves.toBe('failed');
    });

    it('reports a declined consent as denied, and still consumes the state', async () => {
      const state = await started();
      await expect(
        flow.complete({ code: undefined, state, error: 'access_denied' }),
      ).resolves.toBe('denied');
      await expect(
        flow.complete({ code: CODE, state, error: undefined }),
      ).resolves.toBe('failed');
    });

    it('fails on any other error Google reports', async () => {
      const state = await started();
      await expect(
        flow.complete({ code: CODE, state, error: 'server_error' }),
      ).resolves.toBe('failed');
      expect(oauth.exchangeCode).not.toHaveBeenCalled();
    });

    it.each([
      ['no code', undefined],
      ['an empty code', ''],
      ['a repeated code', [CODE, CODE]],
    ])('fails with %s', async (_label, code) => {
      const state = await started();
      await expect(
        flow.complete({ code, state, error: undefined }),
      ).resolves.toBe('failed');
      expect(oauth.exchangeCode).not.toHaveBeenCalled();
    });

    it('fails when Google refuses the code', async () => {
      const state = await started();
      oauth.exchangeCode.mockRejectedValue(
        new GoogleOAuthError(400, 'invalid_grant'),
      );
      await expect(
        flow.complete({ code: CODE, state, error: undefined }),
      ).resolves.toBe('failed');
      expect(repo.saved).toHaveLength(0);
    });

    it('reports denied when the calendar box was left unticked', async () => {
      const state = await started();
      oauth.exchangeCode.mockResolvedValue({
        refreshToken: REFRESH,
        accountEmail: 'events@acme.co.th',
        grantedScopes: ['openid', 'email'],
      });
      await expect(
        flow.complete({ code: CODE, state, error: undefined }),
      ).resolves.toBe('denied');
      expect(repo.saved).toHaveLength(0);
    });

    it('fails when Google withholds the refresh token', async () => {
      const state = await started();
      oauth.exchangeCode.mockResolvedValue({
        refreshToken: null,
        accountEmail: 'events@acme.co.th',
        grantedScopes: [...CALENDAR_SCOPES],
      });
      await expect(
        flow.complete({ code: CODE, state, error: undefined }),
      ).resolves.toBe('failed');
      expect(repo.saved).toHaveLength(0);
    });

    it('never revokes on any callback path — Google revokes grant-wide', async () => {
      for (const grant of [
        { refreshToken: null, grantedScopes: [...CALENDAR_SCOPES] },
        { refreshToken: REFRESH, grantedScopes: ['openid'] },
        { refreshToken: REFRESH, grantedScopes: [...CALENDAR_SCOPES] },
      ]) {
        const state = await started();
        oauth.exchangeCode.mockResolvedValueOnce({
          accountEmail: null,
          ...grant,
        });
        await flow.complete({ code: CODE, state, error: undefined });
      }
      expect(oauth.revoke).not.toHaveBeenCalled();
    });

    it('still reports connected when re-sending the meetings fails', async () => {
      const state = await started();
      meetings.resyncUnsynced.mockRejectedValue(new Error('pool exhausted'));
      await expect(
        flow.complete({ code: CODE, state, error: undefined }),
      ).resolves.toBe('connected');
      expect(repo.saved).toHaveLength(1);
    });

    it('turns an unexpected throw into failed, never into an exception', async () => {
      const state = await started();
      repo.takePendingState.mockRejectedValueOnce(new Error('db down'));
      await expect(
        flow.complete({ code: CODE, state, error: undefined }),
      ).resolves.toBe('failed');
    });

    it('logs neither the code, the token nor the account', async () => {
      const spies = [
        jest.spyOn(Logger.prototype, 'log'),
        jest.spyOn(Logger.prototype, 'warn'),
        jest.spyOn(Logger.prototype, 'error'),
      ];
      const state = await started();
      meetings.resyncUnsynced.mockRejectedValue(new Error('pool exhausted'));
      await flow.complete({ code: CODE, state, error: undefined });
      oauth.exchangeCode.mockRejectedValue(new GoogleOAuthError(400));
      await flow.complete({
        code: CODE,
        state: await started(),
        error: undefined,
      });
      const logged = JSON.stringify(spies.map((s) => s.mock.calls));
      for (const secret of [CODE, REFRESH, 'events@acme.co.th', state]) {
        expect(logged).not.toContain(secret);
      }
    });
  });
});
