import type { Tx } from '../../db/tenant';
import type { InvoicesRepository } from './invoices.repository';
import { OrderInvoiceAdapter } from './order-invoice.adapter';
import { REFUND_VOID_REASON } from '../../common/constants/invoices.constants';

const ORG = 7;
const ORDER_ID = 'o-1';
const tx = {} as Tx;

describe('OrderInvoiceAdapter (US-FIN-02, US-FIN-06/07)', () => {
  let repo: jest.Mocked<InvoicesRepository>;
  let adapter: OrderInvoiceAdapter;

  beforeEach(() => {
    repo = {
      markPaidForOrderIn: jest.fn().mockResolvedValue(undefined),
      voidForRefundIn: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<InvoicesRepository>;
    adapter = new OrderInvoiceAdapter(repo);
  });

  /**
   * An invoice prints the organizer's calendar day. 20:00 UTC on 1 June is
   * already 03:00 on 2 June in Bangkok, so that is the day it was paid.
   */
  it('dates the payment on the Bangkok calendar day it cleared', async () => {
    await adapter.markPaidIn(tx, {
      organizationId: ORG,
      orderId: ORDER_ID,
      method: 'PromptPay',
      paidAt: new Date('2026-06-01T20:00:00Z'),
    });
    expect(repo.markPaidForOrderIn).toHaveBeenCalledWith(tx, {
      organizationId: ORG,
      orderId: ORDER_ID,
      paidVia: 'PromptPay',
      paidOn: '2026-06-02',
    });
  });

  it('voids the invoice as the refund’s, by whoever issued it', async () => {
    const now = new Date('2026-06-03T04:00:00Z');
    await adapter.voidForRefundIn(tx, {
      organizationId: ORG,
      orderId: ORDER_ID,
      actorUserId: 'admin-1',
      now,
    });
    expect(repo.voidForRefundIn).toHaveBeenCalledWith(tx, {
      organizationId: ORG,
      orderId: ORDER_ID,
      voidedBy: 'admin-1',
      voidReason: REFUND_VOID_REASON,
      now,
    });
  });
});
