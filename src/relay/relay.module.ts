import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { DatabaseModule } from '../db/database.module';
import { OutboxReaderPort } from './outbox-reader.port';
import { OutboxReader } from './outbox-reader.repository';
import { OutboxRelay } from './outbox-relay';
import { PublisherPort } from './publisher.port';
import { RabbitPublisher } from './rabbit-publisher';

/** Composition for the outbox relay entrypoint (separate deployable from the API). */
@Module({
  imports: [AppConfigModule, DatabaseModule],
  providers: [
    OutboxRelay,
    { provide: OutboxReaderPort, useClass: OutboxReader },
    { provide: PublisherPort, useClass: RabbitPublisher },
  ],
})
export class RelayModule {}
