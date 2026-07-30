import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import type { Env } from '../config/env.validation';
import { type PublishMessage, PublisherPort } from './publisher.port';

type Connection = Awaited<ReturnType<typeof amqp.connect>>;
type ConfirmChannel = Awaited<ReturnType<Connection['createConfirmChannel']>>;

/** amqplib publisher with publisher confirms (at-least-once). */
@Injectable()
export class RabbitPublisher
  extends PublisherPort
  implements OnModuleInit, OnModuleDestroy
{
  private connection?: Connection;
  private channel?: ConfirmChannel;
  private readonly exchange: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    super();
    this.exchange = config.get('RABBITMQ_EXCHANGE', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    const url = this.config.get('RABBITMQ_URL', { infer: true });
    if (!url) throw new Error('RABBITMQ_URL is required to run the relay');
    this.connection = await amqp.connect(url);
    this.channel = await this.connection.createConfirmChannel();
    await this.channel.assertExchange(this.exchange, 'topic', {
      durable: true,
    });
  }

  async publish(message: PublishMessage): Promise<void> {
    if (!this.channel) throw new Error('Publisher not connected');
    this.channel.publish(
      this.exchange,
      message.routingKey,
      Buffer.from(JSON.stringify(message.payload)),
      {
        messageId: message.messageId,
        contentType: 'application/json',
        persistent: true,
      },
    );
    await this.channel.waitForConfirms();
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.channel?.close();
    } catch {
      /* ignore */
    }
    try {
      await this.connection?.close();
    } catch {
      /* ignore */
    }
  }
}
