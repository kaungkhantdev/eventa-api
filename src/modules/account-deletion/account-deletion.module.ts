import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthPasswordModule } from '../auth-password/auth-password.module';
import { AuthTwoFactorModule } from '../auth-two-factor/auth-two-factor.module';
import { PlatformModule } from '../platform/platform.module';
import { AccountDeletionController } from './account-deletion.controller';
import { AccountDeletionRepository } from './account-deletion.repository';
import { AccountDeletionService } from './account-deletion.service';

/**
 * Account deletion (US-DISC-14): the attendee danger zone — the non-refundable
 * warning preflight and the confirmed, re-verified deletion itself. Depends on
 * AuthPasswordModule (password re-verification), AuthTwoFactorModule (code
 * re-verification when enrolled), and PlatformModule (the transactional outbox
 * that hands the confirmation email + PDPA anonymization to the worker). Writes
 * stay inside the identity family's tables; one-way edges, no forwardRef.
 */
@Module({
  imports: [
    AuthModule,
    AuthPasswordModule,
    AuthTwoFactorModule,
    PlatformModule,
  ],
  controllers: [AccountDeletionController],
  providers: [AccountDeletionService, AccountDeletionRepository],
})
export class AccountDeletionModule {}
