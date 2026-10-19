import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { seatMaps, seats } from '../../db/schema';
import { type Tx, withTenant } from '../../db/tenant';
import { SeatOccupancyPort } from './ports/seat-occupancy.port';
import { TicketQuantityPort } from './ports/ticket-quantity.port';
import type {
  NewSeatPosition,
  NewSeatValues,
  ReservedPlan,
  ReservedPlanner,
  SeatMapRow,
  SeatRetype,
  SeatRow,
  SeatTypeRow,
} from './event-seating.types';

/** Parameters describing a reserved layout to apply. */
export interface ReservedParams {
  eventId: string;
  name: string;
  rows: number;
  seatsPerRow: number;
}

/** Data access for seat maps + seats (Events & Program context). Tenant-scoped. */
@Injectable()
export class EventSeatingRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly occupancy: SeatOccupancyPort,
    private readonly quantities: TicketQuantityPort,
  ) {}

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

  /** Every seat of the map and its ticket type — how a map's types are read back. */
  async seatTypes(
    organizationId: number,
    seatMapId: number,
  ): Promise<SeatTypeRow[]> {
    return withTenant(this.db, organizationId, (tx) =>
      tx
        .select({
          rowLabel: seats.rowLabel,
          seatNumber: seats.seatNumber,
          ticketTypeId: seats.ticketTypeId,
        })
        .from(seats)
        .where(
          and(
            eq(seats.organizationId, organizationId),
            eq(seats.seatMapId, seatMapId),
          ),
        ),
    );
  }

  /**
   * Apply a reserved layout in ONE transaction (US-EVT-05). The locks are taken
   * in a fixed order — the seat map, then the event's live ticket types, then
   * the map's seats — the same tiers-before-seats order checkout uses, so the
   * two never deadlock. `plan` decides on what was read (and throws to refuse);
   * the seats are then written, and when any seat carries a ticket type each
   * type's quantity is set to its seats through Ticketing, inside the same
   * transaction, so the seats and the quantities can never disagree.
   */
  async applyReserved(
    organizationId: number,
    params: ReservedParams,
    plan: ReservedPlanner,
    now: Date,
  ): Promise<SeatMapRow> {
    return withTenant(this.db, organizationId, async (tx) => {
      const existing = await this.lockMap(tx, organizationId, params.eventId);
      const tiers = await this.quantities.lockLiveTiersIn(
        tx,
        organizationId,
        params.eventId,
      );
      const current = existing ? await this.lockSeats(tx, existing.id) : [];
      const occupiedSeatIds = await this.occupancy.occupiedSeatIdsIn(
        tx,
        organizationId,
        current.map((s) => s.id),
        now,
      );
      const decided = plan({ seats: current, tiers, occupiedSeatIds });
      const mapId = await this.saveMap(tx, organizationId, params, existing);
      await this.writeSeats(tx, organizationId, mapId, decided);
      if (decided.seatsByTier) {
        await this.quantities.setSeatQuantitiesIn(
          tx,
          organizationId,
          params.eventId,
          decided.seatsByTier,
        );
      }
      return this.mapById(tx, mapId);
    });
  }

  /** Remove the event's seat map (cascades to its seats). Used when switching to GA. */
  async clearSeating(organizationId: number, eventId: string): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      await tx.delete(seatMaps).where(this.mapWhere(organizationId, eventId));
    });
  }

  /** `FOR UPDATE`, so concurrent reconfigurations serialize instead of racing. */
  private async lockMap(
    tx: Tx,
    organizationId: number,
    eventId: string,
  ): Promise<SeatMapRow | undefined> {
    const [map] = await tx
      .select()
      .from(seatMaps)
      .where(this.mapWhere(organizationId, eventId))
      .limit(1)
      .for('update');
    return map;
  }

  private lockSeats(tx: Tx, seatMapId: number): Promise<SeatRow[]> {
    return tx
      .select()
      .from(seats)
      .where(eq(seats.seatMapId, seatMapId))
      .orderBy(asc(seats.id))
      .for('update');
  }

  /** Create the map, or rewrite its layout. A fresh create is serialized by `uq_seat_maps_event`. */
  private async saveMap(
    tx: Tx,
    organizationId: number,
    params: ReservedParams,
    existing: SeatMapRow | undefined,
  ): Promise<number> {
    const layout = { rows: params.rows, seatsPerRow: params.seatsPerRow };
    const totalSeats = params.rows * params.seatsPerRow;
    if (existing) {
      await tx
        .update(seatMaps)
        .set({ name: params.name, layout, totalSeats, updatedAt: new Date() })
        .where(eq(seatMaps.id, existing.id));
      return existing.id;
    }
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

  private async writeSeats(
    tx: Tx,
    organizationId: number,
    seatMapId: number,
    plan: ReservedPlan,
  ): Promise<void> {
    if (plan.removedSeatIds.length > 0) {
      await tx.delete(seats).where(inArray(seats.id, plan.removedSeatIds));
    }
    await this.retypeSeats(tx, plan.retyped);
    await this.insertSeats(tx, organizationId, seatMapId, plan.added);
  }

  /** One statement per new type: every seat moving to it at once. */
  private async retypeSeats(tx: Tx, retyped: SeatRetype[]): Promise<void> {
    for (const group of retyped) {
      await tx
        .update(seats)
        .set({ ticketTypeId: group.ticketTypeId, updatedAt: new Date() })
        .where(inArray(seats.id, group.seatIds));
    }
  }

  private async insertSeats(
    tx: Tx,
    organizationId: number,
    seatMapId: number,
    positions: NewSeatPosition[],
  ): Promise<void> {
    if (positions.length === 0) return;
    const values: NewSeatValues[] = positions.map((p) => ({
      organizationId,
      seatMapId,
      section: p.section,
      rowLabel: p.rowLabel,
      seatNumber: p.seatNumber,
      ticketTypeId: p.ticketTypeId,
    }));
    await tx.insert(seats).values(values);
  }

  private async mapById(tx: Tx, mapId: number): Promise<SeatMapRow> {
    const [map] = await tx
      .select()
      .from(seatMaps)
      .where(eq(seatMaps.id, mapId))
      .limit(1);
    return map;
  }

  private mapWhere(organizationId: number, eventId: string) {
    return and(
      eq(seatMaps.organizationId, organizationId),
      eq(seatMaps.eventId, eventId),
      isNull(seatMaps.deletedAt),
    );
  }
}
