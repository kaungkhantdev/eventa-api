import { Logger } from '@nestjs/common';
import { SecretCipher } from '../../common/crypto/secret-cipher';
import type { AuthContext } from '../auth/auth.types';
import type { PermissionsService } from '../access/permissions.service';
import type { CalendarConnectionRepository } from './calendar-connection.repository';
import { CalendarConnectionService } from './calendar-connection.service';
import type { CalendarConnectionRow } from './calendar-connection.types';
import { GoogleOAuthError, GoogleOAuthPort } from './ports/google-oauth.port';

const KEY = Buffer.alloc(32, 7).toString('base64');
const ORG = 7;
const REFRESH = '1//the-refresh-token';

const auth: AuthContext = {
  userId: 'u-admin',
  organizationId: ORG,
  sessionId: 's-1',
  persona: 'admin',
};

class StubOAuth extends GoogleOAuthPort {
  configured = true;
  authorizeUrl = jest.fn<string, [string, string]>();
  exchangeCode = jest.fn();
  revoke = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
}

describe('CalendarConnectionService (US-MTG-08)', () => {
  let cipher: SecretCipher;
  let repo: jest.Mocked<CalendarConnectionRepository>;
  let oauth: StubOAuth;
  let granted: string[];
  let service: CalendarConnectionService;

  const row = (
    o: Partial<CalendarConnectionRow> = {},
  ): CalendarConnectionRow => ({
    id: 1,
    organizationId: ORG,
    status: 'connected',
    accountEmail: 'events@acme.co.th',
    refreshTokenCipher: cipher.encrypt(REFRESH),
    connectedBy: 'u-admin',
    connectedAt: new Date('2026-10-20T03:00:00Z'),
    disconnectedAt: null,
    oauthStateHash: null,
    oauthStateUserId: null,
    oauthVerifierCipher: null,
    oauthStateExpiresAt: null,
    createdAt: new Date('2026-10-20T03:00:00Z'),
    updatedAt: new Date('2026-10-20T03:00:00Z'),
    ...o,
  });

  beforeEach(() => {
    cipher = new SecretCipher({ getOrThrow: () => KEY } as never);
    repo = {
      find: jest.fn().mockResolvedValue(null),
      disconnect: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<CalendarConnectionRepository>;
    oauth = new StubOAuth();
    granted = ['setIntegrations', 'setSettings'];
    const permissions = {
      getFor: jest.fn(() => Promise.resolve(granted)),
    } as unknown as PermissionsService;
    service = new CalendarConnectionService(repo, oauth, cipher, permissions);
  });

  describe('status', () => {
    it('reads no row as disconnected', async () => {
      await expect(service.status(auth)).resolves.toMatchObject({
        status: 'disconnected',
        accountEmail: null,
      });
    });

    it('reports a connected workspace with its account to an Admin', async () => {
      repo.find.mockResolvedValue(row());
      await expect(service.status(auth)).resolves.toEqual({
        provider: 'google',
        status: 'connected',
        accountEmail: 'events@acme.co.th',
        connectedAt: '2026-10-20T03:00:00.000Z',
      });
      expect(repo.find).toHaveBeenCalledWith(ORG);
    });

    it('reports an expired connection', async () => {
      repo.find.mockResolvedValue(row({ status: 'expired' }));
      await expect(service.status(auth)).resolves.toMatchObject({
        status: 'expired',
      });
    });

    it('says not_configured over a connected row when the server has no Google client', async () => {
      oauth.configured = false;
      repo.find.mockResolvedValue(row());
      await expect(service.status(auth)).resolves.toMatchObject({
        status: 'not_configured',
        accountEmail: null,
        connectedAt: null,
      });
    });

    it('withholds the account from a member without Manage integrations', async () => {
      granted = ['regView'];
      repo.find.mockResolvedValue(row());
      await expect(service.status(auth)).resolves.toMatchObject({
        status: 'connected',
        accountEmail: null,
      });
    });
  });

  describe('disconnect', () => {
    it('revokes the decrypted token at Google and reports disconnected', async () => {
      repo.disconnect.mockResolvedValue(cipher.encrypt(REFRESH));
      repo.find.mockResolvedValue(row({ status: 'disconnected' }));
      await expect(service.disconnect(auth)).resolves.toMatchObject({
        status: 'disconnected',
      });
      expect(repo.disconnect).toHaveBeenCalledWith(ORG);
      expect(oauth.revoke).toHaveBeenCalledWith(REFRESH);
    });

    it('still disconnects when Google refuses the revoke, and logs no token', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      repo.disconnect.mockResolvedValue(cipher.encrypt(REFRESH));
      oauth.revoke.mockRejectedValue(
        new GoogleOAuthError(400, 'invalid_token'),
      );
      await expect(service.disconnect(auth)).resolves.toMatchObject({
        status: 'disconnected',
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain(REFRESH);
      warn.mockRestore();
    });

    it('still disconnects when the stored token cannot be decrypted', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      repo.disconnect.mockResolvedValue(Buffer.from('not a cipher at all'));
      await expect(service.disconnect(auth)).resolves.toMatchObject({
        status: 'disconnected',
      });
      expect(oauth.revoke).not.toHaveBeenCalled();
    });

    it('revokes nothing when nothing was held', async () => {
      await service.disconnect(auth);
      expect(oauth.revoke).not.toHaveBeenCalled();
    });

    it('revokes nothing when this server has no Google client', async () => {
      oauth.configured = false;
      repo.disconnect.mockResolvedValue(cipher.encrypt(REFRESH));
      await expect(service.disconnect(auth)).resolves.toMatchObject({
        status: 'not_configured',
      });
      expect(oauth.revoke).not.toHaveBeenCalled();
    });
  });
});
