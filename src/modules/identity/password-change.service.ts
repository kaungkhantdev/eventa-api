import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import type { AuthContext } from './auth.types';
import { MessageResponseDto } from './dto/message-response.dto';
import { PasswordRepository } from './password.repository';
import { PasswordService } from './password.service';

const WRONG_CURRENT = 'Your current password is incorrect.';
const REUSED = 'Please choose a password different from your current one.';
const CHANGED = 'Your password has been changed.';

/** Change a password while signed in (US-ACC-05 / US-SET-02). */
@Injectable()
export class PasswordChangeService {
  constructor(
    private readonly repo: PasswordRepository,
    private readonly passwords: PasswordService,
  ) {}

  /**
   * Verify the current password, set the new one, and sign out this user's OTHER
   * devices (the current session stays). Wrong current password → 403, nothing
   * signed out; new password equal to current → 422.
   */
  async change(
    actor: AuthContext,
    currentPassword: string,
    newPassword: string,
  ): Promise<MessageResponseDto> {
    const currentHash = await this.repo.currentHash(
      actor.organizationId,
      actor.userId,
    );
    if (
      !currentHash ||
      !(await this.passwords.verify(currentHash, currentPassword))
    ) {
      throw DomainException.forbidden(WRONG_CURRENT);
    }
    if (await this.passwords.verify(currentHash, newPassword)) {
      throw DomainException.validation(REUSED);
    }
    const passwordHash = await this.passwords.hash(newPassword);
    await this.repo.setPassword(
      actor.organizationId,
      actor.userId,
      passwordHash,
      actor.sessionId, // keep the current device signed in
    );
    return { message: CHANGED };
  }
}
