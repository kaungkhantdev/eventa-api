import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { notificationKindEnum } from '../../db/schema';
import type { AuthContext } from '../auth/auth.types';
import { ProfileService } from '../users/profile.service';
import {
  NotificationPreferencesRepository,
  type NotificationCategory,
} from './notification-preferences.repository';

/** Every topic a member can be alerted about — derived from the schema enum. */
const ALL_CATEGORIES = notificationKindEnum.enumValues;

/** Defaults when a member has never touched a topic. */
const DEFAULT_EMAIL = true;
const DEFAULT_SMS = false;

export interface PreferenceView {
  category: NotificationCategory;
  emailEnabled: boolean;
  smsEnabled: boolean;
  /** False when there's no phone on file — the SMS switch is unavailable. */
  smsAvailable: boolean;
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
    const smsAvailable = Boolean(me.phone);
    const byCategory = new Map(stored.map((r) => [r.category, r]));
    return ALL_CATEGORIES.map((category) => {
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
    if (values.smsEnabled === true) await this.assertPhoneOnFile(auth);
    await this.repo.set(auth.organizationId, auth.userId, category, values);
    return this.list(auth);
  }

  /** SMS can't be switched on with nowhere to send it. */
  private async assertPhoneOnFile(auth: AuthContext): Promise<void> {
    const me = await this.profile.get(auth);
    if (!me.phone) {
      throw DomainException.validation(
        'Add a phone number to your profile before turning on SMS alerts.',
      );
    }
  }
}
