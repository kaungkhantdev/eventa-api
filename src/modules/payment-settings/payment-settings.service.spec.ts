import { DomainException } from '../../common/errors/domain.exception';
import type { Clock } from '../../common/time/clock';
import type { OrganizationService } from '../organization/organization.service';
import { PaymentSettingsRepository } from './payment-settings.repository';
import { PaymentSettingsService } from './payment-settings.service';
import type { PaymentSettingsRow } from './payment-settings.types';

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

/**
 * Checkout and receipt preferences only. Connecting, testing and disconnecting
 * moved to `PaymentKeysService` when credentials became per-workspace — a
 * secret should have exactly one door, and this is not it.
 */
describe('PaymentSettingsService', () => {
  let repo: jest.Mocked<PaymentSettingsRepository>;
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
    organization = {
      get: jest.fn().mockResolvedValue({ currency: 'THB' }),
    } as unknown as jest.Mocked<OrganizationService>;
    const clock: Clock = { now: () => NOW };
    service = new PaymentSettingsService(repo, organization, clock);
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
