import type { OutboxPort } from '../../src/modules/platform/outbox.port';

/**
 * The outbox, for specs that assert what a service enqueued.
 *
 * Both methods, always: a hand-rolled `{ enqueue }` stopped matching the port
 * the day `enqueueIn` was added, and nothing said so because ts-jest does not
 * type-check. A service that moves to `enqueueIn` then fails its assertions
 * here, loudly, instead of a mock quietly missing the call.
 */
export function outboxDouble(): jest.Mocked<OutboxPort> {
  return {
    enqueue: jest.fn().mockResolvedValue(undefined),
    enqueueIn: jest.fn().mockResolvedValue(undefined),
  };
}
