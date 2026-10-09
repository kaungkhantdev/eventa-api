import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { notificationKindEnum } from '../../db/schema';
import type { AuthContext } from '../auth/auth.types';
import { ProfileService } from '../users/profile.service';
import {
  NotificationPreferencesRepository,
  type NotificationCategory,
} from './notification-preferences.repository';

/**
 * Which topics each audience can be alerted about (both derived from the schema
 * enum). Organizers watch their events' commerce; attendees manage reminders and
 * marketing (US-DISC-12). Order confirmations and receipts are transactional —
 * they are deliberately in NEITHER list, so nothing here can switch them off.
 */
const ATTENDEE_CATEGORIES = ['reminder', 'marketing'] as const;
const ORGANIZER_CATEGORIES = notificationKindEnum.enumValues.filter(
  (kind) => !(ATTENDEE_CATEGORIES as readonly string[]).includes(kind),
);

/** Defaults when a member has never touched a topic. */
const DEFAULT_EMAIL = true;
const DEFAULT_SMS = false;

export interface PreferenceView {
  category: NotificationCategory;
  emailEnabled: boolean;
  smsEnabled: boolean;
  /**
   * False when there's no CONFIRMED phone on file — the SMS switch is
   * unavailable. An unconfirmed number does not count: see `smsReachable`.
   */
  smsAvailable: boolean;
}

/**
 * Is there a number Eventa is allowed to text?
 *
 * "On file" is not enough, and this is the second half of US-DISC-11 AC3. A
 * number only becomes textable once a code sent to it has been typed back
 * (`phoneVerified`), so a member who types a number and immediately switches
 * SMS alerts on would otherwise have sent this workspace's alerts to a number
 * nobody proved — which is exactly the mistyped-digit case the criterion
 * exists for, arriving through this endpoint instead of the profile one.
 *
 * Derived on every read rather than copied into the preference row, so there
 * is no stored "SMS is usable" that can disagree with the profile after a
 * number is changed or removed.
 */
function smsReachable(me: { phone: string | null; phoneVerified: boolean }) {
  return Boolean(me.phone) && me.phoneVerified;
}

/**
 * Per-topic email/SMS choices (US-SET-06). These gate *optional* alerts only —
 * receipts and other legally required transactional messages always send, which
 * is why nothing here can switch them off.
 */
@Injectable()
export class NotificationPreferencesService {
  constructor(
    private readonly repo: NotificationPreferencesRepository,
    private readonly profile: ProfileService,
  ) {}

  async list(auth: AuthContext): Promise<PreferenceView[]> {
    const [stored, me] = await Promise.all([
      this.repo.list(auth.organizationId, auth.userId),
      this.profile.get(auth),
    ]);
    const smsAvailable = smsReachable(me);
    const byCategory = new Map(stored.map((r) => [r.category, r]));
    return categoriesFor(auth).map((category) => {
      const row = byCategory.get(category);
      return {
        category,
        emailEnabled: row?.emailEnabled ?? DEFAULT_EMAIL,
        smsEnabled: row?.smsEnabled ?? DEFAULT_SMS,
        smsAvailable,
      };
    });
  }

  async set(
    auth: AuthContext,
    category: NotificationCategory,
    values: { emailEnabled?: boolean; smsEnabled?: boolean },
  ): Promise<PreferenceView[]> {
    if (values.smsEnabled === true) await this.assertTextable(auth);
    assertOwnCategory(auth, category);
    await this.repo.set(auth.organizationId, auth.userId, category, values);
    return this.list(auth);
  }

  /**
   * SMS can't be switched on with nowhere to send it — nor with a number
   * nobody has proved. The two refusals are separate sentences because the
   * remedies are: one is "add a number", the other is "you already have one,
   * finish confirming it".
   */
  private async assertTextable(auth: AuthContext): Promise<void> {
    const me = await this.profile.get(auth);
    if (!me.phone) {
      throw DomainException.validation(
        'Add a phone number to your profile before turning on SMS alerts.',
      );
    }
    if (!me.phoneVerified) {
      throw DomainException.validation(
        'Confirm your phone number with the code we texted before turning on SMS alerts.',
      );
    }
  }
}

/** The topic list for the caller's audience. */
function categoriesFor(auth: AuthContext): readonly NotificationCategory[] {
  return auth.persona === 'attendee'
    ? ATTENDEE_CATEGORIES
    : ORGANIZER_CATEGORIES;
}

/** An attendee cannot toggle payout alerts, nor an organizer marketing. */
function assertOwnCategory(
  auth: AuthContext,
  category: NotificationCategory,
): void {
  if ((categoriesFor(auth) as readonly string[]).includes(category)) return;
  throw DomainException.validation(
    "That notification topic isn't part of your settings.",
  );
}
