import { vatInclusiveBreakdown } from '../../common/money/vat';
import { TicketResponseDto } from './dto/ticket-response.dto';
import type { UpdatedTicketResponseDto } from './dto/updated-ticket-response.dto';
import type { WaitlistOfferOutcome } from './ports/waitlist-offers.port';
import type { TicketRow } from './ticketing.types';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Map a ticket_types row to its response DTO, adding the VAT-inclusive split. */
export function toTicketResponse(
  t: TicketRow,
  vatRate: number,
): TicketResponseDto {
  const { grossSatang, netSatang, vatSatang } = vatInclusiveBreakdown(
    t.priceSatang,
    vatRate,
  );
  return {
    id: t.id,
    eventId: t.eventId,
    name: t.name,
    isFree: t.isFree,
    priceSatang: grossSatang,
    netSatang,
    vatSatang,
    currency: t.currency,
    status: t.status,
    admissionType: t.admissionType,
    sold: t.sold,
    total: t.total,
    minPerOrder: t.minPerOrder,
    maxPerOrder: t.maxPerOrder,
    salesStartAt: iso(t.salesStartAt),
    salesEndAt: iso(t.salesEndAt),
    version: t.version,
  };
}

/** An edited tier, and what the edit's new places did for its waitlist. */
export function toUpdatedTicketResponse(
  t: TicketRow,
  vatRate: number,
  waitlist: WaitlistOfferOutcome,
): UpdatedTicketResponseDto {
  return {
    ...toTicketResponse(t, vatRate),
    waitlistOffered: waitlist.offered,
    waitlistOfferInterrupted: waitlist.interrupted,
  };
}
