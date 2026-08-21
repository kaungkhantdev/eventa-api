import type { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain.exception';
import type { Clock } from '../../common/time/clock';
import type { Env } from '../../config/env.validation';
import type { Tx } from '../../db/tenant';
import type {
  OrderPaymentPort,
  PayableOrder,
} from './ports/order-payment.port';
import type {
  MerchantAccount,
  MerchantAccountPort,
} from './ports/merchant-account.port';
import type {
  PaymentProviderPort,
  StartedPayment,
  VerifiedWebhook,
} from './ports/payment-provider.port';
import type { PaymentRow, PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';

const NOW = new Date('2026-06-01T00:00:00Z');
const ORDER_ID = 'o-1';
const ORG = 7;
const BAHT = 100;
const TOTAL = 2_100 * BAHT;

function payable(o: Partial<PayableOrder> = {}): PayableOrder {
  return {
    id: ORDER_ID,
    organizationId: ORG,
    reference: 'ORD-7K2M9QX4',
    eventId: 'e-1',
    buyerName: 'Anan Suksawat',
    buyerEmail: 'anan@example.test',
    status: 'pending',
    paymentStatus: 'pending',
    totalSatang: TOTAL,
    currency: 'THB',
    ...o,
  };
}

function started(o: Partial<StartedPayment> = {}): StartedPayment {
  return {
    gatewayRef: 'fake_pi_abc',
    status: 'requires_action',
    clientSecret: 'fake_pi_abc_secret',
    promptPayQr: null,
    expiresAt: null,
    declineReason: null,
    ...o,
  };
}

function paymentRow(o: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: 'p-1',
    organizationId: ORG,
    orderId: ORDER_ID,
    method: 'Card',
    amountSatang: TOTAL,
    status: 'pending',
    gatewayRef: 'fake_pi_abc',
    ...o,
  } as PaymentRow;
}

function verified(o: Partial<VerifiedWebhook> = {}): VerifiedWebhook {
  return {
    eventId: 'evt_1',
    type: 'succeeded',
    gatewayRef: 'fake_pi_abc',
    amountSatang: TOTAL,
    declineReason: null,
    ...o,
  };
}

/** The workspace's own Stripe account — where its money is supposed to land. */
const ACCOUNT = 'acct_workspace7';

function merchantPort(
  account: Partial<MerchantAccount> = {},
): jest.Mocked<MerchantAccountPort> {
  return {
    findAccount: jest
      .fn()
      .mockResolvedValue({ connected: true, accountId: ACCOUNT, ...account }),
  };
}

const message = (e: unknown) => (e as DomainException).message;

describe('PaymentsService (US-DISC-05)', () => {
  let repo: jest.Mocked<PaymentsRepository>;
  let provider: jest.Mocked<PaymentProviderPort>;
  let orders: jest.Mocked<OrderPaymentPort>;
  let merchants: jest.Mocked<MerchantAccountPort>;
  let service: PaymentsService;

  beforeEach(() => {
    repo = {
      orgStatementDescriptor: jest.fn().mockResolvedValue('EVENTA*TECHWEEK'),
      upsertAttempt: jest.fn().mockResolvedValue(paymentRow()),
      findByGatewayRef: jest.fn().mockResolvedValue(paymentRow()),
      markPaidIn: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
      recordWebhook: jest.fn().mockResolvedValue(true),
      markWebhookProcessed: jest.fn().mockResolvedValue(undefined),
      otherPaidPaymentExists: jest.fn().mockResolvedValue(false),
      updateGatewayRef: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PaymentsRepository>;
    provider = {
      start: jest.fn().mockResolvedValue(started()),
      verifyWebhook: jest.fn().mockReturnValue(verified()),
    };
    orders = {
      findPayable: jest.fn().mockResolvedValue(payable()),
      settle: jest.fn().mockResolvedValue({
        outcome: 'settled',
        reference: 'ORD-7K2M9QX4',
        ticketCount: 2,
      }),
      releaseHolds: jest.fn().mockResolvedValue(undefined),
      queueRefund: jest.fn().mockResolvedValue(undefined),
    };
    merchants = merchantPort();
    const clock: Clock = { now: () => NOW };
    const config = {
      getOrThrow: () => 'fake',
    } as unknown as ConfigService<Env, true>;
    service = new PaymentsService(
      repo,
      provider,
      orders,
      merchants,
      clock,
      config,
    );
  });

  const pay = (o: Record<string, unknown> = {}) =>
    service.pay({
      orderId: ORDER_ID,
      method: 'Card',
      idempotencyKey: 'attempt-1',
      ...o,
    } as never);

  describe('pay — starting to collect', () => {
    it('charges the order’s own total, never an amount from the caller', async () => {
      await pay();
      expect(provider.start).toHaveBeenCalledWith(
        expect.objectContaining({
          amountSatang: TOTAL,
          currency: 'THB',
          orderId: ORDER_ID,
          organizationId: ORG,
          idempotencyKey: 'attempt-1',
        }),
      );
    });

    it('hands a card buyer the client secret for the hosted fields', async () => {
      const res = await pay();
      expect(res.clientSecret).toBe('fake_pi_abc_secret');
      expect(res.promptPayQr).toBeNull();
      expect(res.amountSatang).toBe(TOTAL);
      expect(res.amountLabel).toBe('฿2,100');
    });

    it('hands a PromptPay buyer the QR and its deadline', async () => {
      provider.start.mockResolvedValue(
        started({
          clientSecret: null,
          promptPayQr: '000201qr',
          expiresAt: new Date('2026-06-01T00:15:00Z'),
        }),
      );
      const res = await pay({ method: 'PromptPay' });
      expect(provider.start).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'PromptPay' }),
      );
      expect(res.promptPayQr).toBe('000201qr');
      expect(res.expiresAt).toBe('2026-06-01T00:15:00.000Z');
    });

    it('sends the workspace’s statement descriptor with the charge', async () => {
      await pay();
      expect(repo.orgStatementDescriptor).toHaveBeenCalledWith(ORG);
      expect(provider.start).toHaveBeenCalledWith(
        expect.objectContaining({ statementDescriptor: 'EVENTA*TECHWEEK' }),
      );
    });

    /**
     * The whole point of a connected account. Eventa holds one platform secret
     * and charges ON BEHALF OF each workspace, so the money reaches the
     * organizer who sold the ticket. Passing null here — which is what this
     * service did — quietly collects every workspace's takings into the
     * platform's own Stripe balance, while Payouts goes on trying to pay out
     * from the organizer's empty one.
     */
    it('charges on the workspace’s own connected account', async () => {
      await pay();
      expect(merchants.findAccount).toHaveBeenCalledWith(ORG);
      expect(provider.start).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: ACCOUNT }),
      );
    });

    // A refund has to reverse on the account that took the money, and the
    // settings row can change underneath it. See the 0050 migration.
    it('stamps the account on the payment, for the refund to read back', async () => {
      await pay();
      expect(repo.upsertAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ gatewayAccountId: ACCOUNT }),
      );
    });

    describe('when the workspace has not connected an account', () => {
      /**
       * Refusing is the only honest answer. Collecting into the platform
       * account would take a buyer's money into a balance the organizer cannot
       * reach, issue a valid ticket against it, and leave a payout that can
       * never settle — a mess that is far harder to unpick than a checkout
       * that stopped.
       */
      it('refuses to collect rather than banking it elsewhere', async () => {
        merchants.findAccount.mockResolvedValue({
          connected: false,
          accountId: null,
        });
        await expect(pay()).rejects.toBeInstanceOf(DomainException);
        expect(provider.start).not.toHaveBeenCalled();
      });

      it('says so in words a buyer can make sense of', async () => {
        merchants.findAccount.mockResolvedValue({
          connected: false,
          accountId: null,
        });
        // The buyer cannot fix this and did nothing wrong, so the message
        // names the organizer's setup rather than blaming the attempt.
        await expect(pay().catch(message)).resolves.toMatch(
          /organizer.*payment account/i,
        );
      });

      // A row can say connected and carry no reference; charging "on behalf
      // of" nothing is a platform charge wearing a workspace's label.
      it('refuses a connected row that names no account', async () => {
        merchants.findAccount.mockResolvedValue({
          connected: true,
          accountId: null,
        });
        await expect(pay()).rejects.toBeInstanceOf(DomainException);
        expect(provider.start).not.toHaveBeenCalled();
      });
    });

    it('records the attempt against the order', async () => {
      await pay();
      expect(repo.upsertAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG,
          orderId: ORDER_ID,
          gatewayRef: 'fake_pi_abc',
          amountSatang: TOTAL,
          method: 'Card',
          idempotencyKey: 'attempt-1',
          status: 'pending',
        }),
      );
    });

    it('404s for an order that does not exist', async () => {
      orders.findPayable.mockResolvedValue(null);
      const err = await pay().catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(404);
      expect(provider.start).not.toHaveBeenCalled();
    });

    it('refuses an order that is already paid', async () => {
      orders.findPayable.mockResolvedValue(
        payable({ status: 'confirmed', paymentStatus: 'paid' }),
      );
      const err = await pay().catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect(message(err)).toMatch(/already.*paid/i);
    });

    it('refuses a cancelled order', async () => {
      orders.findPayable.mockResolvedValue(payable({ status: 'cancelled' }));
      expect(
        ((await pay().catch((e: unknown) => e)) as DomainException).getStatus(),
      ).toBe(409);
    });

    it('refuses a free order — there is nothing to collect', async () => {
      orders.findPayable.mockResolvedValue(payable({ totalSatang: 0 }));
      const err = await pay().catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect(provider.start).not.toHaveBeenCalled();
    });

    it('records an immediate decline and tells the buyer why', async () => {
      provider.start.mockResolvedValue(
        started({
          status: 'failed',
          clientSecret: null,
          declineReason: 'Your card was declined. Please try another card.',
        }),
      );
      repo.upsertAttempt.mockResolvedValue(paymentRow({ status: 'failed' }));
      const res = await pay();
      expect(res.status).toBe('failed');
      expect(res.declineReason).toMatch(/declined/i);
      expect(repo.upsertAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed' }),
      );
      // A decline never touches the order — the buyer can retry or switch.
      expect(orders.settle).not.toHaveBeenCalled();
    });

    it('replaying the same key reuses the provider intent, not a new charge', async () => {
      await pay();
      await pay();
      const keys = provider.start.mock.calls.map((c) => c[0].idempotencyKey);
      expect(keys).toEqual(['attempt-1', 'attempt-1']);
    });
  });

  describe('handleWebhook — the provider is the source of truth', () => {
    const raw = Buffer.from('{}');

    it('refuses an unverifiable callback outright', async () => {
      provider.verifyWebhook.mockImplementation(() => {
        throw DomainException.forbidden('Invalid webhook signature.');
      });
      await expect(service.handleWebhook(raw, 'bad')).rejects.toThrow(
        /signature/i,
      );
      expect(repo.recordWebhook).not.toHaveBeenCalled();
    });

    it('acknowledges an event type it does not care about', async () => {
      provider.verifyWebhook.mockReturnValue(verified({ type: 'ignored' }));
      const res = await service.handleWebhook(raw, 'sig');
      expect(res).toEqual({ received: true });
      expect(orders.settle).not.toHaveBeenCalled();
    });

    it('processes a given provider event exactly once', async () => {
      repo.recordWebhook.mockResolvedValue(false); // seen before
      await service.handleWebhook(raw, 'sig');
      expect(orders.settle).not.toHaveBeenCalled();
      expect(repo.markPaidIn).not.toHaveBeenCalled();
    });

    it('shrugs off a callback for a payment it does not know', async () => {
      repo.findByGatewayRef.mockResolvedValue(null);
      const res = await service.handleWebhook(raw, 'sig');
      expect(res).toEqual({ received: true });
      expect(orders.settle).not.toHaveBeenCalled();
    });

    it('refuses to settle when the paid amount does not match', async () => {
      provider.verifyWebhook.mockReturnValue(
        verified({ amountSatang: 1 * BAHT }),
      );
      await service.handleWebhook(raw, 'sig');
      expect(orders.settle).not.toHaveBeenCalled();
      expect(repo.markWebhookProcessed).toHaveBeenCalledWith(
        'evt_1',
        ORG,
        'failed',
      );
    });

    it('settles the order when the money arrives, and flips the payment inside that transaction', async () => {
      const tx = {} as Tx;
      orders.settle.mockImplementation(async (_org, _order, record) => {
        await record(tx);
        return { outcome: 'settled', reference: 'ORD-1', ticketCount: 2 };
      });
      await service.handleWebhook(raw, 'sig');
      expect(orders.settle).toHaveBeenCalledWith(
        ORG,
        ORDER_ID,
        expect.any(Function),
      );
      expect(repo.markPaidIn).toHaveBeenCalledWith(tx, 'p-1', NOW);
      expect(repo.markWebhookProcessed).toHaveBeenCalledWith(
        'evt_1',
        ORG,
        'processed',
      );
    });

    it('does not settle twice for a payment already marked paid', async () => {
      repo.findByGatewayRef.mockResolvedValue(paymentRow({ status: 'paid' }));
      await service.handleWebhook(raw, 'sig');
      expect(orders.settle).not.toHaveBeenCalled();
    });

    it('marks a failed payment failed and keeps the seats for a retry', async () => {
      provider.verifyWebhook.mockReturnValue(verified({ type: 'failed' }));
      await service.handleWebhook(raw, 'sig');
      expect(repo.markFailed).toHaveBeenCalledWith('p-1');
      expect(orders.releaseHolds).not.toHaveBeenCalled();
      expect(orders.settle).not.toHaveBeenCalled();
    });

    it('releases the held seats when a PromptPay code expires', async () => {
      provider.verifyWebhook.mockReturnValue(verified({ type: 'expired' }));
      await service.handleWebhook(raw, 'sig');
      expect(repo.markFailed).toHaveBeenCalledWith('p-1');
      expect(orders.releaseHolds).toHaveBeenCalledWith(ORG, ORDER_ID);
    });
  });
});

describe('PaymentsService — money-path defences', () => {
  let repo: jest.Mocked<PaymentsRepository>;
  let provider: jest.Mocked<PaymentProviderPort>;
  let orders: jest.Mocked<OrderPaymentPort>;
  let service: PaymentsService;

  beforeEach(() => {
    repo = {
      orgStatementDescriptor: jest.fn().mockResolvedValue(null),
      upsertAttempt: jest.fn().mockResolvedValue(paymentRow()),
      findByGatewayRef: jest.fn().mockResolvedValue(paymentRow()),
      markPaidIn: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
      recordWebhook: jest.fn().mockResolvedValue(true),
      markWebhookProcessed: jest.fn().mockResolvedValue(undefined),
      otherPaidPaymentExists: jest.fn().mockResolvedValue(false),
      updateGatewayRef: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PaymentsRepository>;
    provider = {
      start: jest.fn().mockResolvedValue(started()),
      verifyWebhook: jest.fn().mockReturnValue(verified()),
    };
    orders = {
      findPayable: jest.fn().mockResolvedValue(payable()),
      settle: jest.fn().mockResolvedValue({
        outcome: 'settled',
        reference: 'ORD-7K2M9QX4',
        ticketCount: 2,
      }),
      releaseHolds: jest.fn().mockResolvedValue(undefined),
      queueRefund: jest.fn().mockResolvedValue(undefined),
    };
    const clock: Clock = { now: () => NOW };
    service = new PaymentsService(
      repo,
      provider,
      orders,
      merchantPort(),
      clock,
      {
        getOrThrow: () => 'fake',
      } as unknown as ConfigService<Env, true>,
    );
  });

  const webhook = () => service.handleWebhook(Buffer.from('{}'), 'sig');

  describe('a second successful payment on an already-settled order', () => {
    beforeEach(() => {
      orders.settle.mockResolvedValue({
        outcome: 'already_settled',
        reference: 'ORD-7K2M9QX4',
        ticketCount: 2,
      });
    });

    it('queues a refund instead of quietly banking it', async () => {
      // The buyer paid by PromptPay AND by card; one order, two live intents.
      repo.otherPaidPaymentExists.mockResolvedValue(true);
      await webhook();
      expect(orders.queueRefund).toHaveBeenCalledWith(
        ORG,
        ORDER_ID,
        expect.objectContaining({ amountSatang: TOTAL }),
      );
    });

    it('does NOT queue a refund when it is merely the same webhook redelivered', async () => {
      repo.otherPaidPaymentExists.mockResolvedValue(false);
      await webhook();
      expect(orders.queueRefund).not.toHaveBeenCalled();
    });
  });

  describe('a webhook that failed midway', () => {
    it('is re-processed when the provider retries, not silently acknowledged', async () => {
      // recordWebhook claims a row that exists but was never finished.
      repo.recordWebhook.mockResolvedValue(true);
      await webhook();
      expect(orders.settle).toHaveBeenCalled();
    });

    it('is skipped once it really has been processed', async () => {
      repo.recordWebhook.mockResolvedValue(false);
      await webhook();
      expect(orders.settle).not.toHaveBeenCalled();
    });
  });

  describe('an idempotency-key replay that produced a NEW intent', () => {
    it('repoints the ledger at the intent the buyer was actually given', async () => {
      // Stripe forgets keys after 24h, so a re-post creates pi_B while our row
      // still names pi_A — and the pi_B webhook would never match anything.
      provider.start.mockResolvedValue(started({ gatewayRef: 'pi_B' }));
      repo.upsertAttempt.mockResolvedValue(paymentRow({ gatewayRef: 'pi_A' }));
      await service.pay({
        orderId: ORDER_ID,
        method: 'Card',
        idempotencyKey: 'attempt-1',
      } as never);
      expect(repo.updateGatewayRef).toHaveBeenCalledWith('p-1', 'pi_B');
    });

    it('leaves the row alone when the provider replayed the same intent', async () => {
      await service.pay({
        orderId: ORDER_ID,
        method: 'Card',
        idempotencyKey: 'attempt-1',
      } as never);
      expect(repo.updateGatewayRef).not.toHaveBeenCalled();
    });
  });
});
