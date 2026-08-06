import type { AuthContext } from '../auth/auth.types';
import type { Clock } from '../../common/time/clock';
import { InvoicesLedgerService } from './invoices-ledger.service';
import type { InvoicesRepository } from './invoices.repository';
import type { InvoiceRow } from './invoices.types';

const ORG = 7;
const BAHT = 100;
const TOTAL = 32_500 * BAHT;
const VAT = 212_617;
/** 09:00 Bangkok on 15 Jun 2026. */
const NOW = new Date('2026-06-15T02:00:00Z');
const TODAY = '2026-06-15';

const auth: AuthContext = {
  userId: 'u-1',
  organizationId: ORG,
  sessionId: 's-1',
  persona: 'admin',
};

const row = (o: Partial<InvoiceRow> = {}): InvoiceRow => ({
  id: 1,
  organizationId: ORG,
  number: 'INV-2026-0001',
  orderId: 'o-1',
  orderReference: 'ORD-2026-0009',
  eventId: 'e-1',
  eventName: 'Bangkok Tech Week',
  buyerName: 'Anan Suksawat',
  buyerEmail: 'anan@example.com',
  issuedAt: '2026-06-01',
  dueAt: '2026-06-24',
  subtotalSatang: TOTAL - VAT,
  vatAmountSatang: VAT,
  amountSatang: TOTAL,
  currency: 'THB',
  status: 'issued',
  paidVia: null,
  paidOn: null,
  voidReason: null,
  ...o,
});

describe('InvoicesLedgerService (US-FIN-06, US-FIN-08)', () => {
  let repo: jest.Mocked<InvoicesRepository>;
  let service: InvoicesLedgerService;

  beforeEach(() => {
    repo = {
      page: jest.fn().mockResolvedValue({ items: [row()], total: 1 }),
      countByStatus: jest
        .fn()
        .mockResolvedValue({ issued: 4, paid: 9, overdue: 2, void: 1 }),
      findById: jest.fn().mockResolvedValue(row()),
    } as unknown as jest.Mocked<InvoicesRepository>;
    const clock: Clock = { now: () => NOW };
    service = new InvoicesLedgerService(repo, clock);
  });

  const list = (o: Record<string, unknown> = {}) => service.list(auth, o);

  it('ages the ledger against today in Bangkok', async () => {
    await list();
    expect(repo.page).toHaveBeenCalledWith(ORG, expect.anything(), TODAY);
  });

  it('passes the status, event and search filters through', async () => {
    await list({ status: 'overdue', eventId: 'e-1', search: 'INV-2026' });
    expect(repo.page).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({
        status: 'overdue',
        eventId: 'e-1',
        search: 'INV-2026',
      }),
      TODAY,
    );
  });

  it('counts every status across the WHOLE ledger, not just this page', async () => {
    const result = await list({ status: 'overdue', page: 2 });
    expect(repo.countByStatus).toHaveBeenCalledWith(
      ORG,
      expect.not.objectContaining({ status: 'overdue' }),
      TODAY,
    );
    expect(result.counts).toEqual({ issued: 4, paid: 9, overdue: 2, void: 1 });
  });

  it('keeps the search in the counts so the tabs match what is listed', async () => {
    await list({ search: 'Anan', status: 'paid' });
    expect(repo.countByStatus).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ search: 'Anan' }),
      TODAY,
    );
  });

  describe('how a row reads', () => {
    it('shows an unpaid invoice 3 days past due as overdue', async () => {
      repo.page.mockResolvedValue({
        items: [row({ dueAt: '2026-06-12' })],
        total: 1,
      });
      const [item] = (await list()).page.items;
      expect(item.status).toBe('overdue');
      expect(item.daysUntilDue).toBe(-3);
    });

    it('shows an invoice due in 9 days as issued', async () => {
      const [item] = (await list()).page.items;
      expect(item.status).toBe('issued');
      expect(item.daysUntilDue).toBe(9);
    });

    it('shows how and when a paid invoice was paid', async () => {
      repo.page.mockResolvedValue({
        items: [row({ status: 'paid', paidVia: 'Card', paidOn: '2026-06-03' })],
        total: 1,
      });
      const [item] = (await list()).page.items;
      expect(item.status).toBe('paid');
      expect(item.paidVia).toBe('Card');
      expect(item.paidOn).toBe('2026-06-03');
    });

    it('restates the VAT split so it reconciles to the amount charged', async () => {
      const [item] = (await list()).page.items;
      expect(item.subtotalSatang + item.vatAmountSatang).toBe(
        item.amountSatang,
      );
      expect(item.amountLabel).toBe('฿32,500');
    });

    it('offers a void on an outstanding invoice but not on a paid one', async () => {
      expect((await list()).page.items[0].canVoid).toBe(true);
      repo.page.mockResolvedValue({
        items: [row({ status: 'paid' })],
        total: 1,
      });
      const [paid] = (await list()).page.items;
      expect(paid.canVoid).toBe(false);
      expect(paid.voidBlockedReason).toMatch(/refund/i);
    });

    it('does not offer a second void on a voided invoice', async () => {
      repo.page.mockResolvedValue({
        items: [row({ status: 'void' })],
        total: 1,
      });
      const [item] = (await list()).page.items;
      expect(item.status).toBe('void');
      expect(item.canVoid).toBe(false);
    });
  });

  describe('one invoice (US-FIN-08)', () => {
    it('returns the reconciling breakdown with its ageing', async () => {
      const detail = await service.detail(auth, 1);
      expect(detail.number).toBe('INV-2026-0001');
      expect(detail.orderReference).toBe('ORD-2026-0009');
      expect(detail.subtotalSatang + detail.vatAmountSatang).toBe(
        detail.amountSatang,
      );
      expect(detail.daysUntilDue).toBe(9);
    });

    it('refuses an invoice belonging to another workspace', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.detail(auth, 1)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });
});
