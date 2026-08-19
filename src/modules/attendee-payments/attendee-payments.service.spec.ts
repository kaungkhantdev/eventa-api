import { DomainException } from '../../common/errors/domain.exception';
import type { UsersRepository } from '../users/users.repository';
import type { AttendeePaymentsRepository } from './attendee-payments.repository';
import { AttendeePaymentsService } from './attendee-payments.service';
import type { ReceiptRow, TransactionRow } from './attendee-payments.types';

const USER_ID = 'u-1';
const EMAIL = 'anan@example.test';
const BAHT = 100;

function txn(o: Partial<TransactionRow> = {}): TransactionRow {
  return {
    paymentId: 'p-1',
    orderId: 'o-1',
    reference: 'ORD-7K2M9QX4',
    eventName: 'Bangkok Tech Week',
    method: 'Card',
    status: 'paid',
    amountSatang: 2_100 * BAHT,
    vatSatang: 13_738,
    paidAt: new Date('2026-05-01T04:00:00Z'),
    ...o,
  };
}

function receipt(o: Partial<ReceiptRow> = {}): ReceiptRow {
  return {
    ...txn(),
    buyerName: 'Anan Suksawat',
    buyerEmail: EMAIL,
    organizerName: 'Acme Events & Co <Ltd>',
    organizerAddress: '88 Bangna, Bangkok',
    organizerTaxId: '0105561234567',
    vatRate: 0.07,
    ...o,
  };
}

describe('AttendeePaymentsService (US-DISC-10)', () => {
  let repo: jest.Mocked<AttendeePaymentsRepository>;
  let service: AttendeePaymentsService;

  beforeEach(() => {
    repo = {
      summaryByEmail: jest.fn().mockResolvedValue({
        totalSpentSatang: 2_100 * BAHT,
        totalRefundedSatang: 500 * BAHT,
        transactionCount: 2,
      }),
      transactionsByEmail: jest
        .fn()
        .mockResolvedValue({ items: [txn()], total: 1 }),
      allTransactionsByEmail: jest.fn().mockResolvedValue([txn()]),
      receiptByIdForEmail: jest.fn().mockResolvedValue(receipt()),
    } as unknown as jest.Mocked<AttendeePaymentsRepository>;
    const users = {
      findProfile: jest
        .fn()
        .mockResolvedValue({ user: { email: EMAIL }, org: {} }),
    } as unknown as jest.Mocked<UsersRepository>;
    service = new AttendeePaymentsService(repo, users);
  });

  describe('summary — the tiles', () => {
    it('reports spent, refunded and count, formatted for the tiles', async () => {
      const res = await service.summary(USER_ID);
      expect(res).toMatchObject({
        totalSpentSatang: 2_100 * BAHT,
        totalRefundedSatang: 500 * BAHT,
        transactionCount: 2,
        totalSpentLabel: '฿2,100',
        totalRefundedLabel: '฿500',
      });
      expect(repo.summaryByEmail).toHaveBeenCalledWith(EMAIL);
    });

    it('shows zeroes, not blanks, for an attendee with no transactions', async () => {
      repo.summaryByEmail.mockResolvedValue({
        totalSpentSatang: 0,
        totalRefundedSatang: 0,
        transactionCount: 0,
      });
      const res = await service.summary(USER_ID);
      expect(res.totalSpentLabel).toBe('฿0');
      expect(res.transactionCount).toBe(0);
    });
  });

  describe('history — the paged list', () => {
    it('lists my transactions with the row details', async () => {
      const page = await service.history(USER_ID, {});
      expect(page.items[0]).toMatchObject({
        reference: 'ORD-7K2M9QX4',
        eventName: 'Bangkok Tech Week',
        method: 'Card',
        status: 'paid',
        amountLabel: '฿2,100',
      });
      expect(page.meta.total).toBe(1);
    });

    it('marks a refunded row so the client can strike it through', async () => {
      repo.transactionsByEmail.mockResolvedValue({
        items: [txn({ status: 'refunded' })],
        total: 1,
      });
      const page = await service.history(USER_ID, {});
      expect(page.items[0].status).toBe('refunded');
    });

    it('pages with the standard clamps', async () => {
      await service.history(USER_ID, { page: 3, limit: 5_000 });
      expect(repo.transactionsByEmail).toHaveBeenCalledWith(EMAIL, {
        limit: 100,
        offset: 200,
      });
    });
  });

  describe('receipt — the VAT breakdown', () => {
    it('renders the 7% breakdown in Baht, all parts consistent', async () => {
      const svg = await service.receiptSvg(USER_ID, 'p-1');
      expect(svg).toContain('<svg');
      expect(svg).toContain('ORD-7K2M9QX4');
      expect(svg).toContain('฿2,100'); // total
      expect(svg).toContain('฿137.38'); // VAT within
      expect(svg).toContain('฿1,962.62'); // ex-VAT
      expect(svg).toContain('VAT 7%');
      expect(svg).toContain('0105561234567'); // organizer tax id
    });

    it('escapes the organizer name — a receipt is not markup', async () => {
      const svg = await service.receiptSvg(USER_ID, 'p-1');
      expect(svg).toContain('Acme Events &amp; Co &lt;Ltd&gt;');
      expect(svg).not.toContain('<Ltd>');
    });

    it('marks a refunded transaction’s receipt REFUNDED', async () => {
      repo.receiptByIdForEmail.mockResolvedValue(
        receipt({ status: 'refunded' }),
      );
      expect(await service.receiptSvg(USER_ID, 'p-1')).toContain('REFUNDED');
    });

    it('is refused for a transaction the caller does not own', async () => {
      repo.receiptByIdForEmail.mockResolvedValue(null);
      const err = await service
        .receiptSvg(USER_ID, 'not-mine')
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(404);
    });
  });

  describe('export — the full list', () => {
    it('renders every transaction as CSV with baht amounts', async () => {
      const csv = await service.exportCsv(USER_ID);
      const [header, row] = csv.trim().split('\n');
      expect(header).toBe(
        'date,reference,event,method,status,amount_baht,vat_baht',
      );
      expect(row).toContain('ORD-7K2M9QX4');
      expect(row).toContain('2100.00');
      expect(row).toContain('137.38');
    });

    it('quotes an event name containing a comma rather than splitting it', async () => {
      repo.allTransactionsByEmail.mockResolvedValue([
        txn({ eventName: 'Design, Build & Ship' }),
      ]);
      const csv = await service.exportCsv(USER_ID);
      expect(csv).toContain('"Design, Build & Ship"');
    });

    it('exports just the header when there is nothing to export', async () => {
      repo.allTransactionsByEmail.mockResolvedValue([]);
      const csv = await service.exportCsv(USER_ID);
      expect(csv.trim().split('\n')).toHaveLength(1);
    });
  });
});
