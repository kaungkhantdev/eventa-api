import { Injectable, Logger } from '@nestjs/common';
import { SecretCipher } from '../../common/crypto/secret-cipher';
import { safeError } from '../../common/errors/safe-error';
import { PermissionsService } from '../access/permissions.service';
import type { AuthContext } from '../auth/auth.types';
import { toCalendarConnectionDto } from './calendar-connection.mapper';
import { CalendarConnectionRepository } from './calendar-connection.repository';
import { MANAGE_INTEGRATIONS } from './calendar-provider';
import type { CalendarConnectionDto } from './dto/calendar-connection.dto';
import { GoogleOAuthPort } from './ports/google-oauth.port';

/**
 * Reading and ending the workspace Google Calendar connection (US-MTG-08).
 * Starting and completing one is `CalendarConnectFlowService`.
 */
@Injectable()
export class CalendarConnectionService {
  private readonly logger = new Logger(CalendarConnectionService.name);

  constructor(
    private readonly repo: CalendarConnectionRepository,
    private readonly oauth: GoogleOAuthPort,
    private readonly cipher: SecretCipher,
    private readonly permissions: PermissionsService,
  ) {}

  /** What the Meetings header and Settings → Integrations show. */
  async status(auth: AuthContext): Promise<CalendarConnectionDto> {
    const [row, granted] = await Promise.all([
      this.repo.find(auth.organizationId),
      this.permissions.getFor(auth.organizationId, auth.userId),
    ]);
    return toCalendarConnectionDto(
      row,
      this.oauth.configured,
      granted.includes(MANAGE_INTEGRATIONS),
    );
  }

  /**
   * Stop syncing: forget the grant here, then withdraw it at Google.
   *
   * The revoke is best-effort and comes AFTER the local delete, because the
   * Admin's "disconnect" must hold even when Google is unreachable or the
   * stored token no longer decrypts — holding a credential we were told to
   * drop is worse than leaving one Google will expire on its own. Meetings
   * already on calendars stay there (US-MTG-08 note).
   */
  async disconnect(auth: AuthContext): Promise<CalendarConnectionDto> {
    const held = await this.repo.disconnect(auth.organizationId);
    if (held && this.oauth.configured) {
      await this.revokeQuietly(auth.organizationId, held);
    }
    return this.status(auth);
  }

  private async revokeQuietly(
    organizationId: number,
    held: Buffer,
  ): Promise<void> {
    try {
      await this.oauth.revoke(this.cipher.decrypt(held));
    } catch (err) {
      this.logger.warn(
        { err: safeError(err), organizationId },
        'Google Calendar revoke failed; disconnected locally',
      );
    }
  }
}
