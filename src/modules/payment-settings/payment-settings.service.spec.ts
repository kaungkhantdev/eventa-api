import { DomainException } from '../../common/errors/domain.exception';
import type { Clock } from '../../common/time/clock';
import type { OrganizationService } from '../organization/organization.service';
import { PaymentSettingsRepository } from './payment-settings.repository';
import { PaymentSettingsService } from './payment-settings.service';
import type { PaymentSettingsRow } from './payment-settings.types';
import type { PaymentProviderPort } from './ports/payment-provider.port';

const orgId = 1;
const NOW = new Date('2026-08-01T00:00:00Z');

function settingsRow(
  overrides: Partial<PaymentSettingsRow> = {},
): PaymentSettingsRow {
  return {
    id: 1,
    organizationId: orgId,
    provider: 'stripe',
    mode: 'test',
    status: 'disconnected',
    accountId: null,
    publishableKey: null,
    connectedAt: null,
    disconnectedAt: null,
    defaultCurrency: 'THB',
    statementDescriptor: null,
    saveCards: false,
    emailReceipts: true,
    version: 1,
    ...overrides,
  } as PaymentSettingsRow;
}

describe('PaymentSettingsService', () => {
  let repo: jest.Mocked<PaymentSettingsRepository>;
  let provider: jest.Mocked<PaymentProviderPort>;
  let organization: jest.Mocked<OrganizationService>;
  let service: PaymentSettingsService;

  beforeEach(() => {
    repo = {
      findOrCreate: jest.fn().mockResolvedValue(settingsRow()),
      update: jest
        .fn()
        .mockImplementation((_o, values: object) =>
          Promise.resolve(settingsRow(values as Partial<PaymentSettingsRow>)),
        ),
    } as unknown as jest.Mocked<PaymentSettingsRepository>;
    provider = {
      verify: jest.fn().mockResolvedValue({ ok: true }),
    };
    organization = {
      get: jest.fn().mockResolvedValue({ currency: 'THB' }),
    } as unknown as jest.Mocked<OrganizationService>;
    const clock: Clock = { now: () => NOW };
    service = new PaymentSettingsService(repo, provider, organization, clock);
  });

  describe('connect (US-SET-08)', () => {
    it('marks the workspace connected and stamps when', async () => {
      const res = await service.connect(orgId, {
        accountId: 'acct_123',
        publishableKey: 'pk_test_abc',
        mode: 'test',
      });
      expect(repo.update).toHaveBeenCalledWith(
        orgId,
        expect.objectContaining({
          status: 'connected',
          accountId: 'acct_123',
          mode: 'test',
          connectedAt: NOW,
        }),
      );
      expect(res.status).toBe('connected');
    });

    it('refuses to connect when the provider rejects the account', async () => {
      provider.verify.mockResolvedValue({
        ok: false,
        reason: 'No such account',
      });
      await expect(
        service.connect(orgId, {
          accountId: 'acct_bad',
          publishableKey: 'pk_test_x',
          mode: 'test',
        }),
      ).rejects.toBeInstanceOf(DomainException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('never stores or returns a secret — only the account ref + publishable key', async () => {
      const res = await service.connect(orgId, {
        accountId: 'acct_123',
        publishableKey: 'pk_test_abc',
        mode: 'live',
      });
      expect(JSON.stringify(res)).not.toMatch(/sk_|secret/i);
      const [, values] = repo.update.mock.calls[0];
      expect(Object.keys(values)).not.toContain('secretKey');
    });
  });

  describe('testConnection (US-SET-08)', () => {
    it('reports success without moving money', async () => {
      repo.findOrCreate.mockResolvedValue(
        settingsRow({ status: 'connected', accountId: 'acct_123' }),
      );
      const res = await service.testConnection(orgId);
      expect(res).toMatchObject({ ok: true });
      expect(provider.verify).toHaveBeenCalledWith('acct_123');
    });

    it('gives the reason when the credentials do not work', async () => {
      repo.findOrCreate.mockResolvedValue(
        settingsRow({ status: 'connected', accountId: 'acct_123' }),
      );
      provider.verify.mockResolvedValue({ ok: false, reason: 'Key revoked' });
      expect(await service.testConnection(orgId)).toMatchObject({
        ok: false,
        reason: 'Key revoked',
      });
    });

    it('refuses when nothing is connected yet', async () => {
      await expect(service.testConnection(orgId)).rejects.toBeInstanceOf(
        DomainException,
      );
    });
  });

  describe('disconnect (US-SET-08)', () => {
    it('switches paid checkout off and stamps when, leaving history alone', async () => {
      repo.findOrCreate.mockResolvedValue(
        settingsRow({ status: 'connected', accountId: 'acct_123' }),
      );
      const res = await service.disconnect(orgId);
      expect(repo.update).toHaveBeenCalledWith(
        orgId,
        expect.objectContaining({
          status: 'disconnected',
          accountId: null,
          publishableKey: null,
          disconnectedAt: NOW,
        }),
      );
      expect(res.status).toBe('disconnected');
    });
  });

  describe('updatePreferences (US-SET-10)', () => {
    it('saves a valid statement descriptor', async () => {
      const res = await service.updatePreferences(orgId, {
        statementDescriptor: 'ACME EVENTS',
        emailReceipts: true,
      });
      expect(res.statementDescriptor).toBe('ACME EVENTS');
    });

    it('rejects a descriptor longer than 22 characters', async () => {
      await expect(
        service.updatePreferences(orgId, {
          statementDescriptor: 'A'.repeat(23),
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('warns — but does not block — when the currency differs from the org', async () => {
      organization.get.mockResolvedValue({
        currency: 'THB',
      } as Awaited<ReturnType<OrganizationService['get']>>);
      const res = await service.updatePreferences(orgId, {
        defaultCurrency: 'USD',
      });
      expect(res.defaultCurrency).toBe('USD');
      expect(res.warnings).toContainEqual(
        expect.stringContaining('differs from the organization currency'),
      );
    });

    it('has no warnings when the currency matches', async () => {
      const res = await service.updatePreferences(orgId, {
        defaultCurrency: 'THB',
      });
      expect(res.warnings).toEqual([]);
    });
  });
});
