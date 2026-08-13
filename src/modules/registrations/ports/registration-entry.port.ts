/** A registration an organizer is entering on someone else's behalf. */
export interface RegistrationEntry {
  organizationId: number;
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  attendee: { name: string; email: string; phone?: string };
  /** US-REG-03's toggle: off means the ticket is created quietly. */
  sendConfirmation: boolean;
  /** The organizer, credited on the order. */
  createdBy: string;
  /** Makes a double-submitted panel resolve to the one booking it meant. */
  idempotencyKey: string;
}

export interface EnteredRegistration {
  orderId: string;
  reference: string;
  status: string;
  paymentStatus: string;
  totalSatang: number;
  vatSatang: number;
  /** "Free", or the VAT-inclusive total in baht — never typed by the organizer. */
  amountLabel: string;
  ticketCount: number;
  /** True when the booking still awaits payment before it can be ticketed. */
  paymentRequired: boolean;
}

/**
 * Adding a walk-up or phone booking by hand (US-REG-03), expressed against the
 * module that owns orders, inventory and pricing.
 *
 * Registrations owns this abstraction (DIP) and Checkout binds the adapter, so
 * a hand-added booking is priced, reserved and placed by exactly the code an
 * attendee's own checkout uses. That is the point: the VAT-inclusive total, the
 * per-order caps, the capacity check and the attendee-directory match are all
 * one implementation, and the organizer never types an amount.
 */
export abstract class RegistrationEntryPort {
  abstract add(entry: RegistrationEntry): Promise<EnteredRegistration>;
}
