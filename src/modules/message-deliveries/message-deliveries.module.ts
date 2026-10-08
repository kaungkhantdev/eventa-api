import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { MessageDeliveriesController } from './message-deliveries.controller';
import { MessageDeliveriesRepository } from './message-deliveries.repository';
import { MessageDeliveriesService } from './message-deliveries.service';

/**
 * The delivery log (US-MSG-06). Read-only: eventa-worker writes these rows as
 * it sends, because that is the only moment anything knows what the transport
 * did with a message.
 */
@Module({
  imports: [AccessModule],
  controllers: [MessageDeliveriesController],
  providers: [MessageDeliveriesService, MessageDeliveriesRepository],
})
export class MessageDeliveriesModule {}
