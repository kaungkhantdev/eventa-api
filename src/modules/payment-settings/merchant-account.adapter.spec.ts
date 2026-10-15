import type { PaymentSettingsRepository } from './payment-settings.repository';
import type { PaymentSettingsRow } from './payment-settings.types';
import { MerchantAccountAdapter } from './merchant-account.adapter';

const ORG = 7;

function settings(o: Partial<PaymentSettingsRow> = {}): PaymentSettingsRow {
  return {
    organizationId: ORG,
    status: 'connected',
    accountId: 'acct_workspace7',
    statementDescriptor: null,
    ...o,
  } as PaymentSettingsRow;
}

describe('MerchantAccountAdapter (US-SET-08, US-SET-10)', () => {
  let repo: jest.Mocked<PaymentSettingsRepository>;
  let adapter: MerchantAccountAdapter;

  beforeEach(() => {
    repo = {
      findOrCreate: jest.fn().mockResolvedValue(settings()),
    } as unknown as jest.Mocked<PaymentSettingsRepository>;
    adapter = new MerchantAccountAdapter(repo);
  });

  it('names the connected account a charge is made on', async () => {
    expect(await adapter.findAccount(ORG)).toMatchObject({
      connected: true,
      accountId: 'acct_workspace7',
    });
  });

  /**
   * US-SET-10: "Given a statement label of 22 characters or fewer, when I
   * save, then it's kept and appears on attendees' card statements for later
   * charges." The label saved on Settings → Payments never reached a charge.
   */
  it('carries the statement label saved on Settings → Payments', async () => {
    repo.findOrCreate.mockResolvedValue(
      settings({ statementDescriptor: 'EVENTA*SUMMIT' }),
    );
    expect((await adapter.findAccount(ORG)).statementDescriptor).toBe(
      'EVENTA*SUMMIT',
    );
  });

  it('carries no label when none was saved', async () => {
    expect((await adapter.findAccount(ORG)).statementDescriptor).toBeNull();
  });
});
