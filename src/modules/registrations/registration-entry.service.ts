import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthContext } from '../auth/auth.types';
import type {
  AddRegistrationDto,
  AddedRegistrationDto,
} from './dto/add-registration.dto';
import { RegistrationEntryPort } from './ports/registration-entry.port';

/**
 * Adding a walk-up or phone booking by hand (US-REG-03).
 *
 * Thin on purpose. Everything that makes a registration correct — the
 * VAT-inclusive total, the per-order cap, the capacity check that reports how
 * many seats are actually left, the attendee-directory match, and issuing the
 * ticket the moment nothing is owed — already exists on the attendee's own
 * checkout, and `RegistrationEntryPort` reaches it rather than reimplementing
 * it. What this service owns is the organizer's framing: their workspace is the
 * tenant (never a workspace named in the request), they are credited on the
 * order, and the confirmation is theirs to send or withhold.
 */
@Injectable()
export class RegistrationEntryService {
  constructor(private readonly entries: RegistrationEntryPort) {}

  add(
    auth: AuthContext,
    input: AddRegistrationDto,
  ): Promise<AddedRegistrationDto> {
    return this.entries.add({
      organizationId: auth.organizationId,
      eventId: input.eventId,
      ticketTypeId: input.ticketTypeId,
      quantity: input.quantity,
      attendee: {
        name: input.name,
        email: input.email,
        phone: input.phone,
      },
      // Defaults ON: the story's toggle starts on, and silently not telling
      // someone they are registered is the surprising outcome, not the safe one.
      sendConfirmation: input.sendConfirmation ?? true,
      createdBy: auth.userId,
      // The panel is a single submit rather than a resumable checkout, so there
      // is no client key to honour — this exists to make the placement's own
      // exactly-once machinery apply to a double-tapped Save.
      idempotencyKey: randomUUID(),
    });
  }
}
