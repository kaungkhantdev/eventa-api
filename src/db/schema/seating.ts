import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, idPk, updatedAt, version } from './_columns';
import { seatStatusEnum } from './enums';
import { events } from './events';
import { organizations } from './organizations';
import { ticketTypes } from './ticketing';

/** A reserved-seating layout for an event (only when seating_mode = reserved). */
export const seatMaps = pgTable(
  'seat_maps',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    layout: jsonb().$type<{ rows: number; seatsPerRow: number }>(),
    totalSeats: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    version: version(),
  },
  (t) => [
    unique('uq_seat_maps_event').on(t.eventId),
    index('ix_seat_maps_org').on(t.organizationId),
  ],
);

/** An individual addressable seat within a seat map. */
export const seats = pgTable(
  'seats',
  {
    id: idPk(),
    organizationId: bigint({ mode: 'number' })
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    seatMapId: bigint({ mode: 'number' })
      .notNull()
      .references(() => seatMaps.id, { onDelete: 'cascade' }),
    section: text(),
    rowLabel: text(),
    seatNumber: text().notNull(),
    ticketTypeId: uuid().references(() => ticketTypes.id, {
      onDelete: 'set null',
    }),
    status: seatStatusEnum().notNull().default('available'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    unique('uq_seats_position').on(
      t.seatMapId,
      t.section,
      t.rowLabel,
      t.seatNumber,
    ),
    index('ix_seats_map').on(t.seatMapId),
    index('ix_seats_ticket_type').on(t.ticketTypeId),
  ],
);
