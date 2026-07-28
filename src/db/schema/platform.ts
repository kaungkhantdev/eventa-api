import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idPk } from './_columns';
import { auditTypeEnum, webhookStatusEnum } from './enums';
import { inet } from './_types';
import { organizations } from './organizations';
import { users } from './identity';

/**
 * Append-only, immutable security/finance audit trail (Platform). Never soft- or
 * hard-deleted; organization retained (ON DELETE RESTRICT), actor nulled.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    type: auditTypeEnum().notNull(),
    title: text().notNull(),
    meta: text(),
    actorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    ipAddress: inet(),
    occurredAt: createdAt(),
  },
  (t) => [
    index('ix_audit_events_org_time').on(t.organizationId, t.occurredAt),
    index('ix_audit_events_type').on(t.type),
    index('ix_audit_events_actor').on(t.actorUserId),
  ],
);

/**
 * Transactional outbox (Platform, ADR-3). A domain event is written in the same
 * DB transaction as its aggregate change; the outbox relay publishes it to
 * RabbitMQ with publisher confirms, then sets published_at.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    aggregateType: text().notNull(),
    aggregateId: text().notNull(),
    routingKey: text().notNull(),
    payload: jsonb().notNull(),
    createdAt: createdAt(),
    publishedAt: timestamp({ withTimezone: true }),
    attempts: integer().notNull().default(0),
    availableAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ix_outbox_unpublished')
      .on(t.publishedAt)
      .where(sql`published_at is null`),
    index('ix_outbox_aggregate').on(t.aggregateType, t.aggregateId),
  ],
);

/**
 * Inbound provider webhook log (Platform) for signature-verified, idempotent
 * (exactly-once) processing. organization_id is nullable — the tenant is resolved
 * lazily from the payload.
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: idPk(),
    provider: text().notNull(),
    providerEventId: text().notNull(),
    eventType: text().notNull(),
    payload: jsonb().notNull(),
    receivedAt: createdAt(),
    processedAt: timestamp({ withTimezone: true }),
    status: webhookStatusEnum().notNull().default('received'),
    organizationId: bigint({ mode: 'number' }).references(
      () => organizations.id,
      { onDelete: 'set null' },
    ),
  },
  (t) => [
    unique('uq_webhook_events_provider_event').on(
      t.provider,
      t.providerEventId,
    ),
    index('ix_webhook_events_processed').on(t.processedAt),
  ],
);
