import { DomainException } from '../../common/errors/domain.exception';
import type { TicketSalesPort } from './ports/ticket-sales.port';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentSettingsRepository } from './payment-settings.repository';
import type { PaymentSettingsRow } from './payment-settings.types';

const orgId = 1;

type StoredRows = Awaited<ReturnType<PaymentSettingsRepository['listMethods']>>;

/** Stored switches, as the repository returns them. */
function rows(enabled: Record<string, boolean>): StoredRows {
  return Object.entries(enabled).map(([method, on]) => ({
    method,
    enabled: on,
  })) as StoredRows;
}

describe('PaymentMethodsService (US-SET-09)', () => {
  let repo: jest.Mocked<PaymentSettingsRepository>;
  let sales: jest.Mocked<TicketSalesPort>;
  let service: PaymentMethodsService;

  const connected = (over: Partial<PaymentSettingsRow> = {}) =>
    ({ status: 'connected', mode: 'live', ...over }) as PaymentSettingsRow;

  beforeEach(() => {
    repo = {
      listMethods: jest.fn().mockResolvedValue([]),
      setMethod: jest.fn().mockResolvedValue(undefined),
      findOrCreate: jest.fn().mockResolvedValue(connected()),
    } as unknown as jest.Mocked<PaymentSettingsRepository>;
    sales = {
      hasPaidTickets: jest.fn().mockResolvedValue(true),
    };
    service = new PaymentMethodsService(repo, sales);
  });

  /**
   * Checkout has always offered Card and PromptPay, and no workspace has a row
   * saying otherwise. Now that checkout honours these switches (US-SET-09),
   * reading an absent row as "off" would take every way to pay away from
   * every live checkout — so those two stay on until an Admin turns them off.
   * Anything else still needs turning on.
   */
  it('lists every known method, leaving Card and PromptPay on until turned off', async () => {
    const res = await service.list(orgId);

    expect(res).toEqual([
      { method: 'Card', enabled: true },
      { method: 'PromptPay', enabled: true },
      { method: 'Bank transfer', enabled: false },
      { method: 'Apple Pay', enabled: false },
      { method: 'Google Pay', enabled: false },
    ]);
  });

  it('keeps a method an Admin turned off, off', async () => {
    repo.listMethods.mockResolvedValue(
      rows({ Card: false, 'Apple Pay': true }),
    );

    const res = await service.list(orgId);

    expect(res.find((m) => m.method === 'Card')?.enabled).toBe(false);
    expect(res.find((m) => m.method === 'Apple Pay')?.enabled).toBe(true);
  });

  /**
   * US-SET-09: "Given I disable a method, when new orders are placed, then
   * that method no longer appears at checkout." Only Card and PromptPay can
   * be collected today, so a wallet switched on is not offered at checkout.
   */
  describe('acceptedAtCheckout', () => {
    it('offers the methods checkout can collect that are switched on', async () => {
      repo.listMethods.mockResolvedValue(rows({ 'Apple Pay': true }));
      expect(await service.acceptedAtCheckout(orgId)).toEqual([
        'Card',
        'PromptPay',
      ]);
    });

    it('drops a method an Admin switched off', async () => {
      repo.listMethods.mockResolvedValue(rows({ PromptPay: false }));
      expect(await service.acceptedAtCheckout(orgId)).toEqual(['Card']);
    });
  });

  it('enables a method', async () => {
    await service.setEnabled(orgId, 'PromptPay', true);
    expect(repo.setMethod).toHaveBeenCalledWith(orgId, 'PromptPay', true);
  });

  it('blocks disabling the last enabled method while paid tickets are sold', async () => {
    repo.listMethods.mockResolvedValue(rows({ Card: false }));
    await expect(
      service.setEnabled(orgId, 'PromptPay', false),
    ).rejects.toBeInstanceOf(DomainException);
    expect(repo.setMethod).not.toHaveBeenCalled();
  });

  it('counts a method that is on by default as enabled', async () => {
    await service.setEnabled(orgId, 'PromptPay', false);
    expect(repo.setMethod).toHaveBeenCalledWith(orgId, 'PromptPay', false);
  });

  it('allows disabling the last method when nothing paid is sold', async () => {
    repo.listMethods.mockResolvedValue(rows({ Card: false }));
    sales.hasPaidTickets.mockResolvedValue(false);
    await service.setEnabled(orgId, 'PromptPay', false);
    expect(repo.setMethod).toHaveBeenCalledWith(orgId, 'PromptPay', false);
  });

  it('refuses a wallet until a live payment account is connected', async () => {
    repo.findOrCreate.mockResolvedValue(connected({ status: 'disconnected' }));
    await expect(
      service.setEnabled(orgId, 'Apple Pay', true),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(repo.setMethod).not.toHaveBeenCalled();
  });

  it('allows a non-wallet method without a connection (e.g. bank transfer)', async () => {
    repo.findOrCreate.mockResolvedValue(connected({ status: 'disconnected' }));
    await service.setEnabled(orgId, 'Bank transfer', true);
    expect(repo.setMethod).toHaveBeenCalled();
  });
});
