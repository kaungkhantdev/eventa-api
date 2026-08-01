import { DomainException } from '../../common/errors/domain.exception';
import type { TicketSalesPort } from './ports/ticket-sales.port';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentSettingsRepository } from './payment-settings.repository';
import type { PaymentSettingsRow } from './payment-settings.types';

const orgId = 1;

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
      countEnabledMethods: jest.fn().mockResolvedValue(2),
      findOrCreate: jest.fn().mockResolvedValue(connected()),
    } as unknown as jest.Mocked<PaymentSettingsRepository>;
    sales = {
      hasPaidTickets: jest.fn().mockResolvedValue(true),
    };
    service = new PaymentMethodsService(repo, sales);
  });

  it('lists every known method, defaulting an absent row to disabled', async () => {
    repo.listMethods.mockResolvedValue([
      { method: 'PromptPay', enabled: true },
    ] as Awaited<ReturnType<PaymentSettingsRepository['listMethods']>>);

    const res = await service.list(orgId);

    expect(res.find((m) => m.method === 'PromptPay')?.enabled).toBe(true);
    expect(res.find((m) => m.method === 'Card')?.enabled).toBe(false);
    expect(res).toHaveLength(5); // Card, PromptPay, Bank transfer, Apple Pay, Google Pay
  });

  it('enables a method', async () => {
    await service.setEnabled(orgId, 'PromptPay', true);
    expect(repo.setMethod).toHaveBeenCalledWith(orgId, 'PromptPay', true);
  });

  it('blocks disabling the last enabled method while paid tickets are sold', async () => {
    repo.countEnabledMethods.mockResolvedValue(1);
    await expect(
      service.setEnabled(orgId, 'PromptPay', false),
    ).rejects.toBeInstanceOf(DomainException);
    expect(repo.setMethod).not.toHaveBeenCalled();
  });

  it('allows disabling the last method when nothing paid is sold', async () => {
    repo.countEnabledMethods.mockResolvedValue(1);
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
