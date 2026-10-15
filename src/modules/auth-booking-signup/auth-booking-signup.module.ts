import { Module } from '@nestjs/common';
import { ResendThrottleService } from '../../common/throttle/resend-throttle.service';
import { AuthModule } from '../auth/auth.module';
import { AuthPasswordModule } from '../auth-password/auth-password.module';
import { AuthSignupModule } from '../auth-signup/auth-signup.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { PlatformModule } from '../platform/platform.module';
import { UsersModule } from '../users/users.module';
import { AuthBookingSignupController } from './auth-booking-signup.controller';
import { AuthBookingSignupService } from './auth-booking-signup.service';
import { BookingClaimLinkService } from './booking-claim-link.service';
import { BookingClaimService } from './booking-claim.service';

/**
 * Create my account from my confirmation (US-DISC-15).
 *
 * THE TRUST RULE it exists to keep: an order's id is shown in the BOOKER's
 * browser before anybody has read the buyer's inbox, and anybody can book with
 * anybody's address — so holding the order id proves nothing about the
 * address. It may only ask for a one-time link to be emailed to the booking's
 * address (`AuthBookingSignupService`). No account exists, and no password is
 * chosen, until that link is opened: `BookingClaimService` creates the account
 * — Active, in the platform organization, signed straight in — from the link's
 * token alone, with the address from the token and the name from the order.
 * The link itself — signed, mailed, and read back — is `BookingClaimLinkService`.
 *
 * What it uses, all through what their owners export:
 *   · `BookingClaimOrderPort` (declared here, bound by Checkout, which owns
 *     orders) — the booking's buyer, event and language, by the order's uuid.
 *   · `TokenService` and `AuthService` (AuthModule) — sign and verify the
 *     claim link's token; open the new account's first session exactly as a
 *     password sign-in does (`startSession`).
 *   · `SignupRepository` (AuthSignupModule) — whether the address already has
 *     an attendee account, which organization is the platform's, and creating
 *     the account the way attendee sign-up does (as auth-social reuses it).
 *   · `PasswordService` (AuthPasswordModule) — hashes the chosen password.
 *   · `UsersRepository` (UsersModule) — reads the new account back for the
 *     session, as auth-social does.
 *   · `OutboxPort` (PlatformModule) — the email rides the outbox to
 *     eventa-worker, which sends it.
 *   · `ResendThrottleService` — the shared cool-off from `common/throttle`,
 *     listed as a provider the way UsersModule lists it.
 *
 * A leaf of its own rather than a facet of auth-signup: it needs CheckoutModule,
 * and auth-signup sits inside the auth ⇄ access cycle that checkout's own
 * imports (events → access) lead back into. Nothing imports this module, so it
 * cannot close that loop, and none of its imports needs a `forwardRef`.
 */
@Module({
  imports: [
    AuthModule,
    AuthPasswordModule,
    AuthSignupModule,
    CheckoutModule,
    PlatformModule,
    UsersModule,
  ],
  controllers: [AuthBookingSignupController],
  providers: [
    AuthBookingSignupService,
    BookingClaimLinkService,
    BookingClaimService,
    ResendThrottleService,
  ],
})
export class AuthBookingSignupModule {}
