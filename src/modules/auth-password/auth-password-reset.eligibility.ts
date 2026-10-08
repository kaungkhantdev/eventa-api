import { socialProviderEnum } from '../../db/schema';
import type {
  AccountStatus,
  LinkedProvider,
  ResetAccount,
} from './auth-password.repository';

/** An account a reset link can actually help: it signs in, with a password. */
export type ResettableAccount = ResetAccount & { passwordHash: string };

type BlockedStatus = Exclude<AccountStatus, 'Active'>;

/** Why an account gets no link. */
type Blocker = BlockedStatus | 'SocialOnly';

/**
 * Which refusal to give when an address has several accounts and none can use
 * a link — the one that gets the person in soonest comes first. An active
 * social-only account can sign in right now; a confirmation link is one click
 * in their own inbox; an invitation needs them to finish setting up; a
 * suspension needs somebody else entirely.
 */
const BLOCKERS_BY_USEFULNESS: readonly Blocker[] = [
  'SocialOnly',
  'Unconfirmed',
  'Invited',
  'Suspended',
];

/**
 * Why a reset cannot help this account yet, keyed on the status blocking it.
 *
 * Only `Active` can sign in, and `reset` deliberately does not change status —
 * so without this an unconfirmed account completed the whole flow, was told
 * "please sign in", and was refused at the door. A success that ends in a
 * locked door is worse than an honest refusal, and every message here names the
 * one thing that actually unblocks them.
 */
const CANNOT_RESET: Record<BlockedStatus, string> = {
  Unconfirmed:
    'That account has not been confirmed yet, so there is no sign-in for a password to unlock. Open the confirmation link emailed when it was created — signing in sends a fresh one.',
  Invited:
    'That invitation has not been accepted yet. Open the invitation email to finish setting the account up, and choose a password there.',
  Suspended:
    'That account is suspended, so resetting its password would not let it back in. Ask a workspace admin to reactivate it.',
};

/** What each provider's sign-in button calls it. */
const PROVIDER_LABEL: Record<LinkedProvider, string> = {
  google: 'Google',
  apple: 'Apple',
  linkedin: 'LinkedIn',
};

/** An active account with no password and no provider left linked to it. */
const NO_PASSWORD_NO_PROVIDER =
  'That account has no password to reset — it signs in through a social provider. Use that sign-in instead.';

export type ResetDecision =
  { send: readonly ResettableAccount[] } | { refuse: string };

/**
 * Who gets a link, or why nobody does (US-ACC-04).
 *
 * Every account the address holds in the audience is weighed, not the first
 * one found: an owner in one workspace can be an invitee in another, and each
 * link resets exactly one account's password — so every account that can use
 * one gets one. Only when none can is there a refusal, and then it is the
 * most useful one to hear.
 *
 * Precondition: at least one account. An address with none is a miss, which
 * the caller counts against the lock.
 */
export function decideReset(accounts: readonly ResetAccount[]): ResetDecision {
  const usable = accounts.filter(isResettable);
  if (usable.length > 0) return { send: usable };
  return { refuse: refusalFor(accounts) };
}

/**
 * The status is asked first. An invitee has no password until they accept, and
 * a suspended account may never have had one; asked the other way round, both
 * were sent to a social sign-in that cannot let either of them in.
 */
function blockerOf(account: ResetAccount): Blocker | null {
  if (account.status !== 'Active') return account.status;
  return account.passwordHash === null ? 'SocialOnly' : null;
}

function isResettable(account: ResetAccount): account is ResettableAccount {
  return blockerOf(account) === null;
}

/** Precondition: at least one account, and none of them resettable. */
function refusalFor(accounts: readonly ResetAccount[]): string {
  const [mostUseful] = accounts
    .map(blockerOf)
    .filter((blocker): blocker is Blocker => blocker !== null)
    .sort(byUsefulness);
  if (mostUseful === 'SocialOnly') {
    return socialOnlyRefusal(providersOfSocialOnly(accounts));
  }
  return CANNOT_RESET[mostUseful];
}

function byUsefulness(a: Blocker, b: Blocker): number {
  return BLOCKERS_BY_USEFULNESS.indexOf(a) - BLOCKERS_BY_USEFULNESS.indexOf(b);
}

/**
 * The providers the person can actually use, in a fixed order. Only the
 * social-only accounts' links count — a suspended account's Google link would
 * send them somewhere they are refused.
 */
function providersOfSocialOnly(
  accounts: readonly ResetAccount[],
): LinkedProvider[] {
  const linked = new Set(
    accounts
      .filter((account) => blockerOf(account) === 'SocialOnly')
      .flatMap((account) => account.providers),
  );
  return socialProviderEnum.enumValues.filter((provider) =>
    linked.has(provider),
  );
}

/**
 * Names the provider the account is linked to. Always saying Google sent a
 * LinkedIn-only organizer, or an Apple-only attendee, to a provider they never
 * used.
 */
function socialOnlyRefusal(providers: readonly LinkedProvider[]): string {
  if (providers.length === 0) return NO_PASSWORD_NO_PROVIDER;
  const names = providers.map((provider) => PROVIDER_LABEL[provider]);
  const buttons = names.map((name) => `“Continue with ${name}”`);
  return `That account signs in with ${orList(names)}, so it has no password to reset. Use ${orList(buttons)} instead.`;
}

/** "A", "A or B", "A, B or C". */
function orList(items: readonly string[]): string {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}
