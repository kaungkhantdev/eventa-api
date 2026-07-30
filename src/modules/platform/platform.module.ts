import { Module } from '@nestjs/common';
import { OutboxPort } from './outbox.port';
import { OutboxRepository } from './outbox.repository';

/**
 * Platform bounded context: the transactional outbox (and, later, idempotency,
 * audit, jobs). Exposes OutboxPort as the abstraction other modules depend on.
 */
@Module({
  providers: [{ provide: OutboxPort, useClass: OutboxRepository }],
  exports: [OutboxPort],
})
export class PlatformModule {}
