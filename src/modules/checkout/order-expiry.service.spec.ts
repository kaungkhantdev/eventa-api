import type { ConfigService } from '@nestjs/config';
import type { Clock } from '../../common/time/clock';
import type { Env } from '../../config/env.validation';
import type { CheckoutRepository } from './checkout.repository';
import { OrderExpiryService } from './order-expiry.service';

const NOW = new Date('2026-06-01T00:30:00Z');
const GRACE_MS = 120_000;
const BATCH = 200;

type Expired = Awaited<ReturnType<CheckoutRepository['expireLapsedOrders']>>;

function harness(expired: Expired = []) {
  const expireLapsedOrders = jest.fn<Promise<Expired>, [unknown]>(() =>
    Promise.resolve(expired),
  );
  const repo = { expireLapsedOrders } as unknown as CheckoutRepository;
  const clock: Clock = { now: () => NOW };
  const config = {
    get: (key: keyof Env) =>
      key === 'ORDER_EXPIRY_GRACE_MS' ? GRACE_MS : BATCH,
  } as unknown as ConfigService<Env, true>;
  return {
    service: new OrderExpiryService(repo, clock, config),
    expireLapsedOrders,
  };
}

const order = (id: string) => ({
  id,
  organizationId: 7,
  reference: `ORD-${id}`,
});

describe('OrderExpiryService', () => {
  it('sweeps with the configured grace period and batch size', async () => {
    const { service, expireLapsedOrders } = harness();

    await service.sweep();

    expect(expireLapsedOrders).toHaveBeenCalledWith({
      now: NOW,
      graceMs: GRACE_MS,
      limit: BATCH,
    });
  });

  it('reports how many orders it closed', async () => {
    const { service } = harness([order('a'), order('b')]);

    await expect(service.sweep()).resolves.toBe(2);
  });

  it('is quiet when there was nothing to close', async () => {
    const { service } = harness([]);

    await expect(service.sweep()).resolves.toBe(0);
  });

  /**
   * The sweep runs on a timer against a live database. A failed tick must not
   * take the process down or stop the next one — the next sweep picks up
   * exactly the same rows, because the query is driven by the data, not by a
   * cursor this service holds.
   */
  it('surfaces a failed sweep to the caller rather than swallowing it', async () => {
    const { service, expireLapsedOrders } = harness();
    expireLapsedOrders.mockRejectedValueOnce(new Error('connection lost'));

    await expect(service.sweep()).rejects.toThrow('connection lost');
  });
});
