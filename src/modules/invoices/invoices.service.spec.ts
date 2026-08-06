import type { AuthContext } from '../auth/auth.types';
import { InvoicesService } from './invoices.service';
import type { InvoicesRepository } from './invoices.repository';
import type {
  BillableOrder,
  InvoiceOrderPort,
} from './ports/invoice-order.port';
import type { InvoicePaymentPort } from './ports/invoice-payment.port';
import type { InvoiceRow } from './invoices.types';
import type { Clock } from '../../common/time/clock';

const ORG = 7;
const BAHT = 100;
/** The story's worked example: ฿48,000 VAT-inclusive. */
const TOTAL = 48_000 * BAHT;
/** 7% embedded in ฿48,000 — what checkout recorded on the order. */
const VAT = 313_084;
const ORDER_ID = '11111111-1111-4111-8111-111111111111';
/** 09:00 in Bangkok on 15 Jun 2026 is still the 15th; ageing is Bangkok's day. */
const NOW = new Date('2026-06-15T02:00:00Z');

const auth: AuthContext = {
  userId: 'admin-1',
  organizationId: ORG,
  sessionId: 's-1',
  persona: 'admin',
};

const order = (o: Partial<BillableOrder> = {}): BillableOrder => ({
  id: ORDER_ID,
  organizationId: ORG,
  reference: 'ORD-2026-0009',
  eventId: 'e-1',
  eventName: 'Bangkok Tech Week',
  buyerName: 'Anan Suksawat',
  buyerEmail: 'anan@example.com',
  totalSatang: TOTAL,
  vatAmountSatang: VAT,
  currency: 'THB',
  ...o,
});

const invoice = (o: Partial<InvoiceRow> = {}): InvoiceRow => ({
  id: 1,
  organizationId: ORG,
  number: 'INV-2026-0001',
  orderId: ORDER_ID,
  orderReference: 'ORD-2026-0009',
  eventId: 'e-1',
  eventName: 'Bangkok Tech Week',
  buyerName: 'Anan Suksawat',
  buyerEmail: 'anan@example.com',
  issuedAt: '2026-06-15',
  dueAt: '2026-06-29',
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

describe('InvoicesService', () => {
  let repo: jest.Mocked<InvoicesRepository>;
  let orders: jest.Mocked<InvoiceOrderPort>;
  let payments: jest.Mocked<InvoicePaymentPort>;
  let service: InvoicesService;

  beforeEach(() => {
    repo = {
      issue: jest.fn().mockResolvedValue({ invoice: invoice(), fresh: true }),
      findById: jest.fn().mockResolvedValue(invoice()),
      markVoid: jest.fn().mockResolvedValue(invoice({ status: 'void' })),
    } as unknown as jest.Mocked<InvoicesRepository>;
    orders = {
      findBillable: jest.fn().mockResolvedValue(order()),
    };
    payments = {
      findSettlement: jest.fn().mockResolvedValue(null),
    };
    const clock: Clock = { now: () => NOW };
    service = new InvoicesService(repo, orders, payments, clock);
  });

  describe('issuing a tax invoice (US-FIN-07)', () => {
    const issue = () => service.issue(auth, { orderId: ORDER_ID });

    it('bills the order total with a VAT split that adds back exactly', async () => {
      await issue();
      const [input] = repo.issue.mock.calls[0];
      expect(input.amountSatang).toBe(TOTAL);
      expect(input.subtotalSatang + input.vatAmountSatang).toBe(TOTAL);
      // The VAT is the one CHARGED at checkout, not a fresh computation.
      expect(input.vatAmountSatang).toBe(VAT);
    });

    it('dates it today in Bangkok with 14-day terms', async () => {
      await issue();
      const [input] = repo.issue.mock.calls[0];
      expect(input.issuedAt).toBe('2026-06-15');
      expect(input.dueAt).toBe('2026-06-29');
    });

    it('snapshots the buyer rather than pointing at the order', async () => {
      // A tax invoice must still name who it was billed to after the buyer
      // edits their account.
      await issue();
      const [input] = repo.issue.mock.calls[0];
      expect(input.buyerName).toBe('Anan Suksawat');
      expect(input.buyerEmail).toBe('anan@example.com');
    });

    it('issues it as Issued when the order has not been paid', async () => {
      const result = await issue();
      expect(repo.issue.mock.calls[0][0].status).toBe('issued');
      expect(result.status).toBe('issued');
    });

    it('issues it as Paid, with how and when, once the order is paid', async () => {
      payments.findSettlement.mockResolvedValue({
        method: 'PromptPay',
        paidOn: '2026-06-14',
      });
      repo.issue.mockResolvedValue({
        invoice: invoice({
          status: 'paid',
          paidVia: 'PromptPay',
          paidOn: '2026-06-14',
        }),
        fresh: true,
      });
      const result = await issue();
      const [input] = repo.issue.mock.calls[0];
      expect(input.status).toBe('paid');
      expect(input.paidVia).toBe('PromptPay');
      expect(input.paidOn).toBe('2026-06-14');
      expect(result.status).toBe('paid');
    });

    it('creates exactly one invoice when issuing is triggered twice', async () => {
      // The partial unique index decides; the repository reports the row that
      // already exists rather than raising, so a double-click is harmless.
      repo.issue.mockResolvedValue({ invoice: invoice(), fresh: false });
      const result = await issue();
      expect(result.number).toBe('INV-2026-0001');
    });

    it('refuses an order with nothing to bill', async () => {
      orders.findBillable.mockResolvedValue(order({ totalSatang: 0 }));
      await expect(issue()).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(repo.issue).not.toHaveBeenCalled();
    });

    it('refuses an order with no buyer email to bill', async () => {
      orders.findBillable.mockResolvedValue(order({ buyerEmail: '' }));
      await expect(issue()).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(repo.issue).not.toHaveBeenCalled();
    });

    it('refuses an order belonging to another workspace', async () => {
      orders.findBillable.mockResolvedValue(null);
      await expect(issue()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('names the actor so the repository can record who issued it', async () => {
      await issue();
      expect(repo.issue.mock.calls[0][0].actorUserId).toBe('admin-1');
    });
  });

  describe('voiding an invoice (US-FIN-10)', () => {
    const voidIt = (reason?: string) => service.voidInvoice(auth, 1, reason);

    it('voids an issued invoice and keeps its number', async () => {
      const result = await voidIt('Raised against the wrong order');
      expect(repo.markVoid).toHaveBeenCalledWith(
        ORG,
        1,
        expect.objectContaining({
          voidedBy: 'admin-1',
          voidReason: 'Raised against the wrong order',
        }),
      );
      expect(result.status).toBe('void');
      expect(result.number).toBe('INV-2026-0001');
    });

    it('voids an overdue invoice too', async () => {
      repo.findById.mockResolvedValue(
        invoice({ status: 'issued', dueAt: '2026-06-01' }),
      );
      await expect(voidIt()).resolves.toMatchObject({ status: 'void' });
    });

    it('refuses to void a paid invoice, pointing at the refund instead', async () => {
      repo.findById.mockResolvedValue(invoice({ status: 'paid' }));
      await expect(voidIt()).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(repo.markVoid).not.toHaveBeenCalled();
    });

    it('refuses to void an already-void invoice', async () => {
      repo.findById.mockResolvedValue(invoice({ status: 'void' }));
      await expect(voidIt()).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('refuses an invoice belonging to another workspace', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(voidIt()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
