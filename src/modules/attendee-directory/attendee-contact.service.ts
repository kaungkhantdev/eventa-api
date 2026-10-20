import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  UQ_ATTENDEES_ORG_EMAIL,
  isUniqueViolation,
} from '../../common/errors/unique-violation';
import type { AuthContext } from '../auth/auth.types';
import { toAttendeeEntry } from './attendee-directory.mapper';
import { AttendeeDirectoryRepository } from './attendee-directory.repository';
import {
  type AttendeeContactRow,
  type AttendeeRow,
  type ContactChanges,
  type ContactField,
} from './attendee-directory.types';
import type { AttendeeEntryDto } from './dto/directory.dto';
import {
  BLANK_NAME,
  CONTACT_FIELDS,
  EMAIL_IN_USE,
  EMAIL_IN_USE_BY_REMOVED,
  MOVED_ELSEWHERE,
  NOT_FOUND,
  NOTHING_TO_CHANGE,
} from '../../common/constants/attendee-directory.constants';

/** What an organizer may correct; `version` guards the write, it is not a field. */
export interface UpdateAttendeeContactInput extends ContactChanges {
  /** The version the form was opened on, when the client tracks it. */
  version?: number;
}

/**
 * Keeping an attendee's contact details current (US-REG-08).
 *
 * The rule worth reading is the third criterion. An address that already
 * belongs to another attendee is NOT a validation error — the organizer typed
 * something perfectly valid, and the workspace simply already knows that
 * person. It is a conflict with one specific remedy, so it is answered `409`
 * with a sentence naming that remedy rather than a field error, and nothing at
 * all is applied: not the email, and not the name or phone sent alongside it.
 *
 * **No merge is performed, by decision.** Criterion 3 asks to be "prompted to
 * merge", and a prompt is what this gives. Actually merging two attendees means
 * moving their orders, tickets, check-ins, invitations, invoices and payments —
 * and `orders.attendee_id` is `ON DELETE SET NULL`, so a merge that got halfway
 * would silently detach somebody's registrations from the person who holds
 * them. Refusing and explaining is strictly better than that, and a real merge
 * is its own story with its own acceptance criteria.
 */
@Injectable()
export class AttendeeContactService {
  constructor(private readonly repo: AttendeeDirectoryRepository) {}

  async updateContact(
    auth: AuthContext,
    attendeeId: number,
    input: UpdateAttendeeContactInput,
  ): Promise<AttendeeEntryDto> {
    const wanted = this.normalise(input);
    const current = await this.require(auth.organizationId, attendeeId);
    if (input.version !== undefined && input.version !== current.version) {
      throw this.movedElsewhere();
    }
    if (wanted.email !== undefined) {
      await this.assertAddressIsFree(
        auth.organizationId,
        attendeeId,
        wanted.email,
      );
    }
    return this.apply(auth, current, wanted);
  }

  /** Save what actually moved; a form saved untouched writes nothing at all. */
  private async apply(
    auth: AuthContext,
    current: AttendeeContactRow,
    wanted: ContactChanges,
  ): Promise<AttendeeEntryDto> {
    const fields = changedFields(current, wanted);
    if (fields.length === 0) return this.currentEntry(auth, current.id);
    const row = await this.save(auth, current, {
      changes: onlyFields(wanted, fields),
      fields,
    });
    if (!row) throw this.movedElsewhere();
    return toAttendeeEntry(row);
  }

  private async save(
    auth: AuthContext,
    current: AttendeeContactRow,
    moved: { changes: ContactChanges; fields: readonly ContactField[] },
  ): Promise<AttendeeRow | null> {
    try {
      return await this.repo.saveContact(auth.organizationId, current.id, {
        ...moved,
        expectedVersion: current.version,
        actorUserId: auth.userId,
        now: new Date(),
      });
    } catch (cause) {
      // The address can be taken between the check above and this write. The
      // index is what actually stops the second writer, and its refusal is the
      // same answer the check would have given — never a 500. The prompt reads
      // as if the winner is a live record, which in a race it almost always is;
      // re-reading the holder to find out costs a query on a path nobody sees.
      if (isUniqueViolation(cause, UQ_ATTENDEES_ORG_EMAIL)) {
        throw this.emailInUse(false);
      }
      throw cause;
    }
  }

  private async currentEntry(
    auth: AuthContext,
    attendeeId: number,
  ): Promise<AttendeeEntryDto> {
    const row = await this.repo.findDirectoryEntry(
      auth.organizationId,
      attendeeId,
    );
    if (!row) throw DomainException.notFound(NOT_FOUND);
    return toAttendeeEntry(row);
  }

  /**
   * Does anybody else in this workspace already hold the address?
   *
   * The lookup counts soft-deleted attendees ON PURPOSE — see
   * `findAttendeeIdByEmail`. Comparison is the database's, not JavaScript's:
   * `attendees.email` is `citext`, so `Rio@x.co` and `rio@x.co` are one
   * address, which is exactly what "already belongs to another attendee" has
   * to mean. A `===` here would miss the collision and then hit the index.
   */
  private async assertAddressIsFree(
    organizationId: number,
    attendeeId: number,
    email: string,
  ): Promise<void> {
    const holder = await this.repo.findAttendeeIdByEmail(organizationId, email);
    if (!holder || holder.id === attendeeId) return;
    throw this.emailInUse(holder.removed);
  }

  private async require(
    organizationId: number,
    attendeeId: number,
  ): Promise<AttendeeContactRow> {
    const row = await this.repo.findContact(organizationId, attendeeId);
    if (!row) throw DomainException.notFound(NOT_FOUND);
    return row;
  }

  /** Trim what was typed, and read an emptied phone field as "clear it". */
  private normalise(input: UpdateAttendeeContactInput): ContactChanges {
    const changes: ContactChanges = {};
    if (input.name !== undefined) changes.name = input.name.trim();
    if (input.email !== undefined) changes.email = input.email.trim();
    if (input.phone !== undefined) changes.phone = input.phone?.trim() || null;
    if (Object.keys(changes).length === 0) {
      throw DomainException.validation(NOTHING_TO_CHANGE);
    }
    // The DTO refuses an empty string; only trimming can produce a blank name.
    if (changes.name === '')
      throw DomainException.invalidField('name', BLANK_NAME);
    return changes;
  }

  private emailInUse(removed: boolean): DomainException {
    return new DomainException(
      ErrorCode.ATTENDEE_EMAIL_IN_USE,
      removed ? EMAIL_IN_USE_BY_REMOVED : EMAIL_IN_USE,
      HttpStatus.CONFLICT,
    );
  }

  private movedElsewhere(): DomainException {
    return DomainException.conflict(MOVED_ELSEWHERE);
  }
}

/**
 * Which fields this save actually moves, in a stable order.
 *
 * An email whose only change is capitalisation DOES count: `citext` compares it
 * equal but stores what it was given, and an organizer fixing `RIO@x.co` to
 * `rio@x.co` is correcting how the address is shown.
 */
function changedFields(
  current: AttendeeContactRow,
  wanted: ContactChanges,
): ContactField[] {
  return CONTACT_FIELDS.filter(
    (field) => wanted[field] !== undefined && wanted[field] !== current[field],
  );
}

function onlyFields(
  wanted: ContactChanges,
  fields: readonly ContactField[],
): ContactChanges {
  const changes: ContactChanges = {};
  if (fields.includes('name')) changes.name = wanted.name;
  if (fields.includes('email')) changes.email = wanted.email;
  if (fields.includes('phone')) changes.phone = wanted.phone ?? null;
  return changes;
}
