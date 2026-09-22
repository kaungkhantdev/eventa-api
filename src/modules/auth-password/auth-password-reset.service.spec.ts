import type { ConfigService } from '@nestjs/config';
import type { Clock } from '../../common/time/clock';
import type { Env } from '../../config/env.validation';
import type { OutboxPort } from '../platform/outbox.port';
import { Persona } from '../auth/auth.types';
import { PasswordResetService } from './auth-password-reset.service';
import { passwordFingerprint } from './auth-password-fingerprint';
import type {
  PasswordRepository,
  ResetAccount,
  ResetLinkAccount,
} from './auth-password.repository';
import type { PasswordService } from './auth-password.service';
import type { TokenService } from '../auth/token.service';
import type { LoginThrottleService } from '../auth/login-throttle.service';
import { IDENTITY_PASSWORD_RESET_REQUESTED } from './events/password-reset-requested.event';
import { outboxDouble } from '../../../test/support/outbox-double';
import { refusalOf } from '../../../test/support/refusal';

/**
 * The message a refusal carried. Typed, unlike `expect.stringMatching` inside
 * `toMatchObject`, which widens the whole object to `any` and takes the lint
 * with it.
 */
async function refusalFrom(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected the call to be refused, but it resolved');
}

const CURRENT_HASH = 'argon2-current-hash';
const FINGERPRINT = passwordFingerprint(CURRENT_HASH);
const user: ResetAccount = {
  id: 'u1',
  organizationId: 7,
  workspaceName: 'Acme Events',
  name: 'Somchai',
  status: 'Active',
  passwordHash: CURRENT_HASH,
  providers: [],
};

/** The account a link signed for u1 in workspace 7 opens, as it is now. */
const organizerLink: ResetLinkAccount = {
  id: 'u1',
  organizationId: 7,
  persona: Persona.Admin,
  workspaceName: 'Acme Events',
  passwordHash: CURRENT_HASH,
};

/** The words a dead link is refused with, on the page and on the form alike. */
const INVALID_LINK =
  'This reset link is invalid or has expired. Request a new one.';

/** The same person's account in a second workspace (US-ACC-02). */
const inWorkspaceB = (overrides: Partial<ResetAccount>): ResetAccount => ({
  ...user,
  id: 'u2',
  organizationId: 8,
  workspaceName: 'Bangkok Summits',
  passwordHash: 'argon2-other-hash',
  ...overrides,
});

describe('PasswordResetService', () => {
  let repo: jest.Mocked<PasswordRepository>;
  let passwords: jest.Mocked<PasswordService>;
  let tokens: jest.Mocked<TokenService>;
  let outbox: jest.Mocked<OutboxPort>;
  let throttle: jest.Mocked<LoginThrottleService>;
  let service: PasswordResetService;

  beforeEach(() => {
    repo = {
      findResetAccounts: jest.fn().mockResolvedValue([user]),
      findResetLinkAccount: jest.fn().mockResolvedValue(organizerLink),
      setPassword: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PasswordRepository>;
    passwords = {
      hash: jest.fn().mockResolvedValue('NEWHASH'),
      verify: jest.fn().mockResolvedValue(false),
    };
    tokens = {
      signPasswordReset: jest.fn().mockResolvedValue('RTOKEN'),
      verifyPasswordReset: jest
        .fn()
        .mockResolvedValue({ sub: 'u1', org: 7, pv: FINGERPRINT }),
    } as unknown as jest.Mocked<TokenService>;
    outbox = outboxDouble();
    const clock: Clock = { now: () => new Date('2026-07-31T00:00:00.000Z') };
    const config = {
      getOrThrow: jest.fn().mockReturnValue('https://web.test'),
    } as unknown as ConfigService<Env, true>;
    throttle = {
      assertNotLocked: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<LoginThrottleService>;
    service = new PasswordResetService(
      repo,
      passwords,
      tokens,
      outbox,
      throttle,
      clock,
      config,
    );
  });

  describe('forgot', () => {
    it('signs a fingerprinted token and enqueues a reset email for a known account', async () => {
      const res = await service.forgot('owner@acme.co.th');

      expect(res.message).toMatch(/on its way/i);
      expect(tokens.signPasswordReset).toHaveBeenCalledWith({
        userId: 'u1',
        organizationId: 7,
        passwordFingerprint: FINGERPRINT,
      });
      const event = outbox.enqueue.mock.calls[0][0];
      expect(event.routingKey).toBe(IDENTITY_PASSWORD_RESET_REQUESTED);
      expect(event.payload.resetUrl).toBe(
        'https://web.test/reset-password?token=RTOKEN',
      );
    });

    /**
     * A deliberate product decision, overriding the usual advice to answer
     * uniformly. Silence for an address with no account is indistinguishable
     * from a mail that was sent and lost, and people were being left to wait
     * for a link that could never arrive.
     *
     * The cost is real: this endpoint now confirms whether an account exists.
     * The throttle below is what keeps that from being a way to farm the list.
     */
    it('says plainly when no account matches, and sends nothing', async () => {
      repo.findResetAccounts.mockResolvedValue([]);
      await expect(service.forgot('ghost@acme.co.th')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    it('names the audience it searched, so the other one can be tried', async () => {
      repo.findResetAccounts.mockResolvedValue([]);
      await expect(
        refusalFrom(service.forgot('ghost@acme.co.th', Persona.Attendee)),
      ).resolves.toMatch(/attendee/i);
      repo.findResetAccounts.mockResolvedValue([]);
      await expect(
        refusalFrom(service.forgot('ghost@acme.co.th')),
      ).resolves.toMatch(/organizer/i);
    });

    /**
     * An account with no password is a social-only sign-in. It exists, so the
     * "no account" answer would be a lie — and it has nothing to reset.
     */
    it('does not claim a social-only account is missing', async () => {
      repo.findResetAccounts.mockResolvedValue([
        { ...user, passwordHash: null, providers: ['google'] },
      ]);
      await expect(
        refusalFrom(service.forgot('owner@acme.co.th')),
      ).resolves.toMatch(/google/i);
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    it('defaults to the organizer audience', async () => {
      await service.forgot('owner@acme.co.th');
      expect(repo.findResetAccounts).toHaveBeenCalledWith(
        'owner@acme.co.th',
        Persona.Admin,
        expect.any(Number),
      );
    });
  });

  /**
   * Only an account that can actually sign in has a password worth resetting.
   *
   * Sign-in refuses anything but `Active`, and reset never touched `status` —
   * so an unconfirmed account could complete the whole flow, be told "please
   * sign in", and be refused at the door. A reset that ends somewhere its own
   * success message sends you, and fails, is worse than an honest refusal.
   */
  describe('forgot — an account has to be usable to be reset', () => {
    it('refuses an unconfirmed account and says what to do instead', async () => {
      repo.findResetAccounts.mockResolvedValue([
        { ...user, status: 'Unconfirmed' },
      ]);
      await expect(
        refusalFrom(service.forgot('owner@acme.co.th')),
      ).resolves.toMatch(/confirm/i);
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    /**
     * Deliberately no fresh confirmation email from here. Sign-in resends one,
     * but only AFTER a correct password; this endpoint takes no credential at
     * all, so sending from it would make it an unauthenticated way to fill
     * somebody's inbox.
     */
    it('sends nothing at all when it refuses', async () => {
      repo.findResetAccounts.mockResolvedValue([
        { ...user, status: 'Unconfirmed' },
      ]);
      await expect(service.forgot('owner@acme.co.th')).rejects.toBeDefined();
      expect(outbox.enqueue).not.toHaveBeenCalled();
      expect(tokens.signPasswordReset).not.toHaveBeenCalled();
    });

    it('refuses a suspended account, pointing at the person who can undo it', async () => {
      repo.findResetAccounts.mockResolvedValue([
        { ...user, status: 'Suspended' },
      ]);
      await expect(
        refusalFrom(service.forgot('owner@acme.co.th')),
      ).resolves.toMatch(/suspend/i);
    });

    it('refuses an unaccepted invitation, naming the invitation', async () => {
      repo.findResetAccounts.mockResolvedValue([
        { ...user, status: 'Invited' },
      ]);
      await expect(
        refusalFrom(service.forgot('owner@acme.co.th')),
      ).resolves.toMatch(/invitation/i);
    });

    /** A blocked status is the account's own state, not a wrong guess at it. */
    it('does not count a blocked status against the brute-force lock', async () => {
      repo.findResetAccounts.mockResolvedValue([
        { ...user, status: 'Unconfirmed' },
      ]);
      await expect(service.forgot('owner@acme.co.th')).rejects.toBeDefined();
      expect(throttle.recordFailure).not.toHaveBeenCalled();
    });
  });

  /**
   * "Signs in with Google" sends a LinkedIn-only organizer, or an Apple-only
   * attendee, to a provider they never used. The provider named is the one the
   * account is actually linked to.
   */
  describe('forgot — a social-only account is sent to its own provider', () => {
    const socialOnly = (providers: ResetAccount['providers']) =>
      repo.findResetAccounts.mockResolvedValue([
        { ...user, passwordHash: null, providers },
      ]);

    it('names LinkedIn for a LinkedIn-only organizer, and not Google', async () => {
      socialOnly(['linkedin']);
      const message = await refusalFrom(service.forgot('owner@acme.co.th'));
      expect(message).toMatch(/Continue with LinkedIn/);
      expect(message).not.toMatch(/google/i);
    });

    it('names Apple for an Apple-only attendee', async () => {
      socialOnly(['apple']);
      const message = await refusalFrom(
        service.forgot('fan@acme.co.th', Persona.Attendee),
      );
      expect(message).toMatch(/Continue with Apple/);
      expect(message).not.toMatch(/google/i);
    });

    it('names every provider linked, so none of them is wrong', async () => {
      socialOnly(['linkedin', 'google']);
      const message = await refusalFrom(service.forgot('owner@acme.co.th'));
      expect(message).toMatch(/Google/);
      expect(message).toMatch(/LinkedIn/);
    });
  });

  /**
   * What is wrong with an account comes before whether it has a password.
   *
   * An invited teammate has no password until they accept, and a suspended
   * account may never have had one. Asked in the other order, both were told
   * to "Continue with Google" — which cannot let either of them in.
   */
  describe('forgot — the status speaks before the missing password', () => {
    it('tells an invitee with no password about the invitation', async () => {
      repo.findResetAccounts.mockResolvedValue([
        { ...user, status: 'Invited', passwordHash: null },
      ]);
      const message = await refusalFrom(service.forgot('owner@acme.co.th'));
      expect(message).toMatch(/invitation/i);
      expect(message).not.toMatch(/google/i);
    });

    it('tells a suspended social-only account it is suspended', async () => {
      repo.findResetAccounts.mockResolvedValue([
        {
          ...user,
          status: 'Suspended',
          passwordHash: null,
          providers: ['google'],
        },
      ]);
      const message = await refusalFrom(service.forgot('owner@acme.co.th'));
      expect(message).toMatch(/suspend/i);
      expect(message).not.toMatch(/google/i);
    });
  });

  /**
   * One address can hold an account in several workspaces (US-ACC-02): a
   * person who owns one workspace and is invited into another has two rows
   * that merely share an email. The answer is about all of them, never about
   * whichever row the database happened to return first.
   */
  describe('forgot — an address with accounts in several workspaces', () => {
    const invitedToB = inWorkspaceB({ status: 'Invited', passwordHash: null });

    it.each([
      ['listed first', [user, invitedToB]],
      ['listed last', [invitedToB, user]],
    ])(
      'sends the link for the active account, whether it is %s',
      async (_order, accounts) => {
        repo.findResetAccounts.mockResolvedValue(accounts);

        const res = await service.forgot('owner@acme.co.th');

        expect(res.message).toMatch(/on its way/i);
        expect(tokens.signPasswordReset).toHaveBeenCalledTimes(1);
        expect(tokens.signPasswordReset).toHaveBeenCalledWith(
          expect.objectContaining({ userId: 'u1', organizationId: 7 }),
        );
      },
    );

    /**
     * A link resets exactly one account's password, so two usable accounts get
     * two links — otherwise the second workspace stays locked however often
     * the form is used.
     */
    it('sends one link per account that can use one', async () => {
      const activeInB = inWorkspaceB({});
      repo.findResetAccounts.mockResolvedValue([user, activeInB]);

      await service.forgot('owner@acme.co.th');

      const signed = tokens.signPasswordReset.mock.calls.map(([c]) => c);
      expect(signed).toEqual([
        { userId: 'u1', organizationId: 7, passwordFingerprint: FINGERPRINT },
        {
          userId: 'u2',
          organizationId: 8,
          passwordFingerprint: passwordFingerprint('argon2-other-hash'),
        },
      ]);
      expect(outbox.enqueue).toHaveBeenCalledTimes(2);
    });

    /** Two links in one inbox are only usable if each says which it opens. */
    it('names the workspace in each organizer email', async () => {
      repo.findResetAccounts.mockResolvedValue([user, inWorkspaceB({})]);

      await service.forgot('owner@acme.co.th');

      const named = outbox.enqueue.mock.calls.map(
        ([event]) => event.payload.workspaceName,
      );
      expect(named).toEqual(['Acme Events', 'Bangkok Summits']);
    });

    /**
     * An attendee's one realm is the platform organization, not a workspace
     * they chose, so naming it would only puzzle them.
     */
    it('names no workspace in an attendee email', async () => {
      await service.forgot('fan@acme.co.th', Persona.Attendee);
      const [[event]] = outbox.enqueue.mock.calls;
      expect(event.payload).not.toHaveProperty('workspaceName');
    });

    it('does not say how many workspaces the address is in', async () => {
      repo.findResetAccounts.mockResolvedValue([user, inWorkspaceB({})]);
      const one = await service.forgot('owner@acme.co.th');
      repo.findResetAccounts.mockResolvedValue([user]);
      const two = await service.forgot('owner@acme.co.th');
      expect(one.message).toBe(two.message);
    });

    it('gives the most useful refusal when no account can use a link', async () => {
      repo.findResetAccounts.mockResolvedValue([
        { ...user, status: 'Suspended' },
        inWorkspaceB({ status: 'Unconfirmed' }),
      ]);
      await expect(
        refusalFrom(service.forgot('owner@acme.co.th')),
      ).resolves.toMatch(/confirm/i);
    });

    /**
     * A social-only account that is active can sign in right now, which beats
     * any account that is waiting on something.
     */
    it('prefers the account that can already sign in another way', async () => {
      repo.findResetAccounts.mockResolvedValue([
        inWorkspaceB({ status: 'Invited', passwordHash: null }),
        { ...user, passwordHash: null, providers: ['linkedin'] },
      ]);
      await expect(
        refusalFrom(service.forgot('owner@acme.co.th')),
      ).resolves.toMatch(/Continue with LinkedIn/);
    });

    it('does not count an address with accounts as a miss', async () => {
      repo.findResetAccounts.mockResolvedValue([
        { ...user, status: 'Suspended' },
        invitedToB,
      ]);
      await expect(service.forgot('owner@acme.co.th')).rejects.toBeDefined();
      expect(throttle.recordFailure).not.toHaveBeenCalled();
    });
  });

  /**
   * The mitigation the plain answer above requires.
   *
   * Once a reset form tells a registered address from an unknown one, it is a
   * membership oracle — so a miss is counted per identity exactly as a failed
   * sign-in is, and enough of them lock the identity out for a cool-off. A
   * scripted sweep gets a handful of answers and then a 429; a person who
   * mistyped their own address gets an honest one.
   */
  describe('forgot — throttling the oracle it creates', () => {
    it('refuses while the identity is in a cool-off', async () => {
      throttle.assertNotLocked.mockRejectedValue(
        Object.assign(new Error('locked'), { code: 'TOO_MANY_REQUESTS' }),
      );
      await expect(service.forgot('ghost@acme.co.th')).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
      });
      // Refused before the lookup: a locked identity learns nothing at all.
      expect(repo.findResetAccounts).not.toHaveBeenCalled();
    });

    it('counts a miss against the identity that was probed', async () => {
      repo.findResetAccounts.mockResolvedValue([]);
      await expect(service.forgot('ghost@acme.co.th')).rejects.toBeDefined();
      expect(throttle.recordFailure).toHaveBeenCalledWith(
        expect.stringContaining('ghost@acme.co.th'),
        'reset',
      );
    });

    /**
     * On the reset form's own count, never sign-in's: otherwise failed sign-ins
     * could lock somebody out of the one form that exists to let them back in.
     */
    it('checks and counts on the reset count, not the sign-in one', async () => {
      repo.findResetAccounts.mockResolvedValue([]);
      await expect(service.forgot('ghost@acme.co.th')).rejects.toBeDefined();
      const [checked, scope] = throttle.assertNotLocked.mock.calls[0];
      const [counted, countScope] = throttle.recordFailure.mock.calls[0];
      expect([scope, countScope]).toEqual(['reset', 'reset']);
      expect(counted).toBe(checked);
    });

    it('keys the count per audience — two realms are two identities', async () => {
      repo.findResetAccounts.mockResolvedValue([]);
      await expect(
        service.forgot('ghost@acme.co.th', Persona.Attendee),
      ).rejects.toBeDefined();
      const [identity] = throttle.recordFailure.mock.calls[0];
      expect(identity).toContain(Persona.Attendee);
    });

    it('counts nothing against an address that does have an account', async () => {
      await service.forgot('owner@acme.co.th');
      expect(throttle.recordFailure).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('sets a new password and signs out every device on a valid link', async () => {
      const res = await service.reset('RTOKEN', 'brandnew1pass');
      expect(passwords.hash).toHaveBeenCalledWith('brandnew1pass');
      expect(repo.setPassword).toHaveBeenCalledWith(7, 'u1', 'NEWHASH');
      expect(res.message).toMatch(/reset/i);
    });

    it('rejects an invalid/expired token (422)', async () => {
      tokens.verifyPasswordReset.mockRejectedValue(new Error('bad'));
      await expect(service.reset('bad', 'brandnew1pass')).rejects.toMatchObject(
        {
          code: 'VALIDATION_ERROR',
        },
      );
    });

    it('rejects a stale/used link whose fingerprint no longer matches (422)', async () => {
      repo.findResetLinkAccount.mockResolvedValue({
        ...organizerLink,
        passwordHash: 'a-different-hash',
      });
      await expect(
        service.reset('RTOKEN', 'brandnew1pass'),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(repo.setPassword).not.toHaveBeenCalled();
    });

    it('rejects a link whose account is gone (422)', async () => {
      repo.findResetLinkAccount.mockResolvedValue(null);
      await expect(
        service.reset('RTOKEN', 'brandnew1pass'),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(repo.setPassword).not.toHaveBeenCalled();
    });

    it('rejects reusing the current password (422)', async () => {
      passwords.verify.mockResolvedValue(true);
      await expect(
        service.reset('RTOKEN', 'brandnew1pass'),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(repo.setPassword).not.toHaveBeenCalled();
    });
  });

  /**
   * The reset page asks this the moment it opens, so a dead link is refused
   * before anybody types a new password into it (US-ACC-04 criterion 7,
   * TC-ACC-10 step 6) — and a good one says which sign-in, and which
   * workspace, it opens.
   */
  describe('check', () => {
    it('says an organizer link opens the admin sign-in, naming its workspace', async () => {
      await expect(service.check('RTOKEN')).resolves.toEqual({
        persona: Persona.Admin,
        workspaceName: 'Acme Events',
      });
    });

    it('reads the account the link was signed for, in its own workspace', async () => {
      await service.check('RTOKEN');
      expect(tokens.verifyPasswordReset).toHaveBeenCalledWith('RTOKEN');
      expect(repo.findResetLinkAccount).toHaveBeenCalledWith(7, 'u1');
    });

    /**
     * An attendee's one realm is the platform organization, not a workspace
     * they chose — naming it would only puzzle them, as it would in the email.
     */
    it('names no workspace for an attendee link', async () => {
      repo.findResetLinkAccount.mockResolvedValue({
        ...organizerLink,
        persona: Persona.Attendee,
        workspaceName: 'Eventa Platform',
      });
      await expect(service.check('RTOKEN')).resolves.toEqual({
        persona: Persona.Attendee,
        workspaceName: null,
      });
    });

    it.each<[string, () => void]>([
      [
        'a used link — the password changed since it was sent',
        () =>
          repo.findResetLinkAccount.mockResolvedValue({
            ...organizerLink,
            passwordHash: 'a-different-hash',
          }),
      ],
      [
        'an expired or forged token',
        () =>
          tokens.verifyPasswordReset.mockRejectedValue(
            new Error('jwt expired'),
          ),
      ],
      [
        'a link whose account is gone',
        () => repo.findResetLinkAccount.mockResolvedValue(null),
      ],
      [
        'a link to an account left with no password',
        () =>
          repo.findResetLinkAccount.mockResolvedValue({
            ...organizerLink,
            passwordHash: null,
          }),
      ],
    ])(
      'refuses %s, with the invalid-link words and nothing else',
      async (_case, arrange) => {
        arrange();
        const refusal = await refusalOf(service.check('RTOKEN'));
        expect(refusal.getStatus()).toBe(422);
        expect(refusal).toMatchObject({
          code: 'VALIDATION_ERROR',
          message: INVALID_LINK,
        });
        expect(refusal.details).toBeUndefined();
      },
    );

    /**
     * Opening the page must not use the link up: somebody who opens it, wanders
     * off and comes back still has to be able to finish.
     */
    it('spends nothing — the same link still resets the password afterwards', async () => {
      await service.check('RTOKEN');
      await service.check('RTOKEN');
      expect(passwords.hash).not.toHaveBeenCalled();
      expect(repo.setPassword).not.toHaveBeenCalled();

      const done = await service.reset('RTOKEN', 'brandnew1pass');
      expect(done.message).toMatch(/reset/i);
      expect(repo.setPassword).toHaveBeenCalledWith(7, 'u1', 'NEWHASH');
    });

    /**
     * The throttle guards the form that confirms whether an address has an
     * account. Checking a link reveals nothing about an address, so a locked
     * address must not stop its owner finishing a reset, and a dead link is
     * not a guess at anybody's address.
     */
    it('neither waits on nor counts against the forgot-password throttle', async () => {
      throttle.assertNotLocked.mockRejectedValue(
        Object.assign(new Error('locked'), { code: 'TOO_MANY_REQUESTS' }),
      );
      await expect(service.check('RTOKEN')).resolves.toBeDefined();
      repo.findResetLinkAccount.mockResolvedValue(null);
      await refusalOf(service.check('RTOKEN'));

      expect(throttle.assertNotLocked).not.toHaveBeenCalled();
      expect(throttle.recordFailure).not.toHaveBeenCalled();
    });

    /**
     * The page promises what the form will do. If the two judged a link by
     * different rules, a link the page called good could be refused on submit,
     * after the person had typed their new password twice.
     */
    it.each<[string, () => void]>([
      [
        'a used link',
        () =>
          repo.findResetLinkAccount.mockResolvedValue({
            ...organizerLink,
            passwordHash: 'a-different-hash',
          }),
      ],
      [
        'an expired token',
        () => tokens.verifyPasswordReset.mockRejectedValue(new Error('exp')),
      ],
      [
        'a vanished account',
        () => repo.findResetLinkAccount.mockResolvedValue(null),
      ],
    ])('refuses %s exactly as the reset does', async (_case, arrange) => {
      arrange();
      const onOpen = await refusalOf(service.check('RTOKEN'));
      const onSubmit = await refusalOf(
        service.reset('RTOKEN', 'brandnew1pass'),
      );
      expect(onOpen.message).toBe(onSubmit.message);
      expect(onOpen.code).toBe(onSubmit.code);
    });
  });
});
