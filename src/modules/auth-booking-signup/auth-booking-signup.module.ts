import { Module } from '@nestjs/common';
import { ResendThrottleService } from '../../common/throttle/resend-throttle.service';
import { AuthModule } from '../auth/auth.module';
import { AuthSignupModule } from '../auth-signup/auth-signup.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { PlatformModule } from '../platform/platform.module';
import { AuthBookingSignupController } from './auth-booking-signup.controller';
import { AuthBookingSignupService } from './auth-booking-signup.service';

/**
 * Create my account from my confirmation (US-DISC-15).
 *
 * THE TRUST RULE it exists to keep: an order's id is shown in the BOOKER's
 * browser before anybody has read the buyer's inbox, and anybody can book with
 * anybody's address — so holding the order id proves nothing about the
 * address. It may only ask for a one-time link to be emailed to the booking's
 * address. No account exists, and no password is chosen, until that link is
 * opened.
 *
 * What it uses, all through what their owners export:
 *   · `BookingClaimOrderPort` (declared here, bound by Checkout, which owns
 *     orders) — the booking's buyer, event and language, by the order's uuid.
 *   · `TokenService` (AuthModule) — signs the claim link's token.
 *   · `SignupRepository` (AuthSignupModule) — whether the address already has
 *     an attendee account, and which organization is the platform's.
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
  imports: [AuthModule, AuthSignupModule, CheckoutModule, PlatformModule],
  controllers: [AuthBookingSignupController],
  providers: [AuthBookingSignupService, ResendThrottleService],
})
export class AuthBookingSignupModule {}
