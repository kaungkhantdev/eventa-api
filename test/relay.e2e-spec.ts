process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';
process.env.RABBITMQ_URL ??= 'amqp://eventa:eventa@localhost:5672';

import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as amqp from 'amqplib';
import { Pool } from 'pg';
import { OutboxRelay } from '../src/relay/outbox-relay';
import { RelayModule } from '../src/relay/relay.module';

const EXCHANGE = 'eventa.events';

type Connection = Awaited<ReturnType<typeof amqp.connect>>;
type Channel = Awaited<ReturnType<Connection['createChannel']>>;

describe('OutboxRelay (integration)', () => {
  let app: INestApplicationContext;
  let relay: OutboxRelay;
  let pool: Pool;
  let conn: Connection;
  let channel: Channel;
  let orgId: number;
  let queue: string;
  const slug = 'relay-it-org';
  const routingKey = `test.relay.${Date.now()}`;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(`DELETE FROM organizations WHERE slug=$1`, [slug]);
    const org = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ('Relay IT', $1) RETURNING id`,
      [slug],
    );
    orgId = Number(org.rows[0].id);

    app = await NestFactory.createApplicationContext(RelayModule, {
      logger: false,
    });
    relay = app.get(OutboxRelay);

    conn = await amqp.connect(process.env.RABBITMQ_URL as string);
    channel = await conn.createChannel();
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    const q = await channel.assertQueue('', { exclusive: true });
    queue = q.queue;
    await channel.bindQueue(queue, EXCHANGE, routingKey);
  }, 30000);

  afterAll(async () => {
    await channel.close().catch(() => undefined);
    await conn.close().catch(() => undefined);
    await app.close();
    await pool.query(`DELETE FROM organizations WHERE id=$1`, [orgId]);
    await pool.end();
  });

  it('publishes a pending outbox row and marks it published', async () => {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO outbox_events (organization_id, aggregate_type, aggregate_id, routing_key, payload)
       VALUES ($1,'test','t1',$2,$3) RETURNING id`,
      [orgId, routingKey, JSON.stringify({ hello: 'world' })],
    );
    const rowId = inserted.rows[0].id;

    const count = await relay.publishPending(50);
    expect(count).toBeGreaterThanOrEqual(1);

    // The message landed on the queue bound to our unique routing key.
    let msg: Awaited<ReturnType<Channel['get']>> = false;
    for (let i = 0; i < 20 && !msg; i++) {
      msg = await channel.get(queue, { noAck: true });
      if (!msg) await new Promise((r) => setTimeout(r, 100));
    }
    expect(msg).toBeTruthy();
    if (msg) {
      expect(msg.properties.messageId).toBe(rowId);
      expect(JSON.parse(msg.content.toString('utf8'))).toEqual({
        hello: 'world',
      });
    }

    // The row is now marked published.
    const after = await pool.query<{ published_at: Date | null }>(
      `SELECT published_at FROM outbox_events WHERE id=$1`,
      [rowId],
    );
    expect(after.rows[0].published_at).not.toBeNull();
  }, 20000);
});
