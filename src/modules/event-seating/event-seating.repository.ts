import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { seatMaps, seats } from '../../db/schema';
import { type Tx, withTenant } from '../../db/tenant';
import type {
  NewSeatValues,
  SeatMapRow,
  SeatPosition,
  SeatRow,
} from './event-seating.types';

/** Parameters describing a reserved layout to apply. */
export interface ReservedParams {
  eventId: string;
  name: string;
  rows: number;
  seatsPerRow: number;
}

/** Result of applying a reserved layout: the map, or a refusal (a sold seat lost). */
export type ApplyReservedResult = { ok: true; map: SeatMapRow } | { ok: false };

/** Data access for seat maps + seats (Events & Program context). Tenant-scoped. */
@Injectable()
export class EventSeatingRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** The event's live seat map (null if none / soft-deleted). */
  async findMap(
    organizationId: number,
    eventId: string,
  ): Promise<SeatMapRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select()
        .from(seatMaps)
        .where(this.mapWhere(organizationId, eventId))
        .limit(1);
      return row ?? null;
    });
  }

  /** The event's seat map plus all its seats (null if there is no map). */
  async getMapWithSeats(
    organizationId: number,
    eventId: string,
  ): Promise<{ map: SeatMapRow; seats: SeatRow[] } | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [map] = await tx
        .select()
        .from(seatMaps)
        .where(this.mapWhere(organizationId, eventId))
        .limit(1);
      if (!map) return null;
      const rows = await tx
        .select()
        .from(seats)
        .where(eq(seats.seatMapId, map.id))
        .orderBy(asc(seats.id));
      return { map, seats: rows };
    });
  }

  /**
   * Apply a reserved layout to `desired` in ONE transaction: lock the event's map
   * row (`FOR UPDATE`, so concurrent reconfigurations serialize instead of racing),
   * re-read its seats, diff against `desired`, refuse if that would drop an
   * already-sold seat (`blockSoldRemoval`), then create/update the map and add/remove
   * seats atomically. A fresh create is serialized by the `uq_seat_maps_event` unique.
   */
  async applyReserved(
    organizationId: number,
    params: ReservedParams,
    desired: SeatPosition[],
    blockSoldRemoval: boolean,
  ): Promise<ApplyReservedResult> {
    const totalSeats = params.rows * params.seatsPerRow;
    const layout = { rows: params.rows, seatsPerRow: params.seatsPerRow };
    return withTenant(this.db, organizationId, async (tx) => {
      const [existingMap] = await tx
        .select()
        .from(seatMaps)
        .where(this.mapWhere(organizationId, params.eventId))
        .limit(1)
        .for('update');
      const existingSeats = existingMap
        ? await tx
            .select()
            .from(seats)
            .where(eq(seats.seatMapId, existingMap.id))
        : [];

      const desiredKeys = new Set(desired.map(positionKey));
      const removed = existingSeats.filter(
        (s) => !desiredKeys.has(positionKey(s)),
      );
      if (blockSoldRemoval && removed.some((s) => s.status === 'sold')) {
        return { ok: false };
      }
      const existingKeys = new Set(existingSeats.map(positionKey));
      const added = desired.filter((p) => !existingKeys.has(positionKey(p)));

      let mapId: number;
      if (!existingMap) {
        mapId = await this.insertMap(
          tx,
          organizationId,
          params,
          layout,
          totalSeats,
        );
      } else {
        mapId = existingMap.id;
        await this.updateMap(tx, mapId, params.name, layout, totalSeats);
        if (removed.length > 0) {
          await tx.delete(seats).where(
            inArray(
              seats.id,
              removed.map((s) => s.id),
            ),
          );
        }
      }
      await this.insertSeats(tx, organizationId, mapId, added);
      const [map] = await tx
        .select()
        .from(seatMaps)
        .where(eq(seatMaps.id, mapId))
        .limit(1);
      return { ok: true, map };
    });
  }

  /** Remove the event's seat map (cascades to its seats). Used when switching to GA. */
  async clearSeating(organizationId: number, eventId: string): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      await tx.delete(seatMaps).where(this.mapWhere(organizationId, eventId));
    });
  }

  private async insertMap(
    tx: Tx,
    organizationId: number,
    params: ReservedParams,
    layout: { rows: number; seatsPerRow: number },
    totalSeats: number,
  ): Promise<number> {
    const [row] = await tx
      .insert(seatMaps)
      .values({
        organizationId,
        eventId: params.eventId,
        name: params.name,
        layout,
        totalSeats,
      })
      .returning({ id: seatMaps.id });
    return row.id;
  }

  private async updateMap(
    tx: Tx,
    mapId: number,
    name: string,
    layout: { rows: number; seatsPerRow: number },
    totalSeats: number,
  ): Promise<void> {
    await tx
      .update(seatMaps)
      .set({ name, layout, totalSeats, updatedAt: new Date() })
      .where(eq(seatMaps.id, mapId));
  }

  private async insertSeats(
    tx: Tx,
    organizationId: number,
    seatMapId: number,
    positions: SeatPosition[],
  ): Promise<void> {
    if (positions.length === 0) return;
    const values: NewSeatValues[] = positions.map((p) => ({
      organizationId,
      seatMapId,
      section: p.section,
      rowLabel: p.rowLabel,
      seatNumber: p.seatNumber,
    }));
    await tx.insert(seats).values(values);
  }

  private mapWhere(organizationId: number, eventId: string) {
    return and(
      eq(seatMaps.organizationId, organizationId),
      eq(seatMaps.eventId, eventId),
      isNull(seatMaps.deletedAt),
    );
  }
}

/** Stable identity of a seat position (for diffing existing seats vs desired). */
function positionKey(p: SeatPosition | SeatRow): string {
  return `${p.section ?? ''}|${p.rowLabel ?? ''}|${p.seatNumber}`;
}
