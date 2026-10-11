import { DomainException } from '../../common/errors/domain.exception';
import {
  MESSAGE_TEMPLATE_CATALOG,
  templateBySlug,
  type MessageTemplateDefinition,
} from './message-template-catalog';
import { MessageTemplatesRepository } from './message-templates.repository';
import {
  MessageTemplatesService,
  assertSwitchable,
} from './message-templates.service';
import { organizerAuth } from '../../../test/support/auth-context';

const auth = organizerAuth();

type StoredRows = Awaited<ReturnType<MessageTemplatesRepository['list']>>;

describe('MessageTemplatesService (US-MSG-01/02)', () => {
  let repo: jest.Mocked<MessageTemplatesRepository>;
  let service: MessageTemplatesService;

  const stored = (rows: { slug: string; active: boolean }[]) =>
    repo.list.mockResolvedValue(rows as StoredRows);

  beforeEach(() => {
    repo = {
      list: jest.fn().mockResolvedValue([]),
      setActive: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MessageTemplatesRepository>;
    service = new MessageTemplatesService(repo);
  });

  describe('the catalog a workspace starts with', () => {
    it('lists every message at its default before anything is stored', async () => {
      // An absent row means the message's default — ON for everything but the
      // reminder, so a workspace that has never opened these settings still
      // sends its confirmations.
      const list = await service.list(auth);
      expect(list).toHaveLength(MESSAGE_TEMPLATE_CATALOG.length);
      expect(
        list.filter((t) => t.slug !== 'event-reminder').every((t) => t.active),
      ).toBe(true);
    });

    it('keeps the event reminder off until the workspace switches it on', async () => {
      // Mail a workspace never asked for is mail it cannot explain to its
      // attendees: the reminder is theirs to choose, not Eventa's.
      const list = await service.list(auth);
      expect(bySlug(list, 'event-reminder').active).toBe(false);
    });

    it('lets a workspace switch the reminder on', async () => {
      stored([{ slug: 'event-reminder', active: true }]);
      const list = await service.list(auth);
      expect(bySlug(list, 'event-reminder').active).toBe(true);
    });

    it('prefers a stored choice over the default', async () => {
      stored([{ slug: 'registration-confirmation', active: false }]);
      const list = await service.list(auth);
      expect(bySlug(list, 'registration-confirmation').active).toBe(false);
      // Everything else is untouched by one workspace's decision.
      expect(bySlug(list, 'cancellation-notice').active).toBe(true);
    });

    it('ignores a stored row for a message no longer in the catalog', async () => {
      // A retired slug must not resurrect itself as a card nobody can explain.
      stored([{ slug: 'sms-blast-2019', active: false }]);
      const list = await service.list(auth);
      expect(list).toHaveLength(MESSAGE_TEMPLATE_CATALOG.length);
    });
  });

  describe('turning a message off', () => {
    it('stores the choice and answers with the new list', async () => {
      // What the re-read sees once the write has landed.
      stored([{ slug: 'registration-confirmation', active: false }]);

      const list = await service.setActive(
        auth,
        'registration-confirmation',
        false,
      );

      expect(repo.setActive).toHaveBeenCalledWith(
        auth.organizationId,
        expect.objectContaining({ slug: 'registration-confirmation' }),
        false,
      );
      expect(bySlug(list, 'registration-confirmation').active).toBe(false);
    });

    it('lets the cancellation notice be switched, because the worker checks it', async () => {
      // A cross-repo contract, not a restatement of the catalog: this passes
      // only for as long as eventa-worker's EventCancelledHandler reads
      // `cancellation-notice` before it sends. If that check is ever removed,
      // this switch goes back to being decorative and this test should fail.
      await expect(
        service.setActive(auth, 'cancellation-notice', false),
      ).resolves.toBeDefined();
      expect(repo.setActive).toHaveBeenCalled();
    });

    it('accepts switching off the payment receipt', async () => {
      // Cross-repo, like the one above: eventa-worker's ReceiptSender reads
      // `payment-receipt` before it sends.
      await expect(
        service.setActive(auth, 'payment-receipt', false),
      ).resolves.toBeDefined();
    });

    it('accepts switching off the waitlist offer', async () => {
      // eventa-worker's waitlist offer handler reads `waitlist-offer` before
      // it sends either the offer or the notice that it lapsed.
      await expect(
        service.setActive(auth, 'waitlist-offer', false),
      ).resolves.toBeDefined();
    });

    it('refuses a message nothing sends yet', () => {
      // Proved on a message made up for the purpose, so the rule outlives any
      // particular catalog: the real planned entries are pinned below, and the
      // day their handlers land and they turn `controlled` this must still
      // guard the next one that is added planned.
      const planned = {
        ...MESSAGE_TEMPLATE_CATALOG[0],
        slug: 'birthday-card',
        title: 'Birthday card',
        delivery: 'planned' as const,
      };
      expect(() => assertSwitchable(planned)).toThrow(DomainException);
      expect(() => assertSwitchable(MESSAGE_TEMPLATE_CATALOG[0])).not.toThrow();
    });

    it('refuses a slug that is not a message at all', async () => {
      await expect(
        service.setActive(auth, 'not-a-message', true),
      ).rejects.toThrow(DomainException);
    });
  });

  describe('what the catalog promises the UI', () => {
    it('has a unique slug per message', () => {
      // A duplicate would silently shadow, and the second card would be unable
      // to save — the stored row is keyed on (organization, slug).
      const slugs = MESSAGE_TEMPLATE_CATALOG.map((t) => t.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    });

    it('never starts a message attendees are entitled to switched off', () => {
      // A new workspace must still confirm registrations and send receipts
      // without anybody having to find this page first.
      const expected = MESSAGE_TEMPLATE_CATALOG.filter((t) => t.expected);
      expect(expected.every((t) => t.defaultActive)).toBe(true);
    });

    it('holds only the event reminder off by default — eventa-worker mirrors this list', () => {
      // The other half of this contract is OFF_UNTIL_SWITCHED_ON_SLUGS in
      // eventa-worker's src/db/schema/messaging.ts, pinned by its own spec. This
      // side decides what the organizer SEES, that side what is SENT: change
      // one without the other and the page says "Inactive" while attendees are
      // mailed, or "Active" while nobody is.
      const offByDefault = MESSAGE_TEMPLATE_CATALOG.filter(
        (t) => !t.defaultActive,
      ).map((t) => t.slug);
      expect(offByDefault).toEqual(['event-reminder']);
    });

    it('marks the messages attendees are entitled to', async () => {
      // US-MSG-02 asks for a warning before one of these is switched off; the
      // UI is told which they are rather than keeping its own list.
      const list = await service.list(auth);
      expect(bySlug(list, 'registration-confirmation').expected).toBe(true);
      expect(bySlug(list, 'payment-receipt').expected).toBe(true);
      expect(bySlug(list, 'event-reminder').expected).toBe(false);
    });

    it('texts only the registration confirmation', async () => {
      // A channel badge is a promise that something sends on it. eventa-worker
      // texts exactly one message — the confirmation (US-DISC-06 AC5) — and
      // nothing it sends goes by SMS besides. The day another handler texts,
      // this test is what has to change with it.
      const list = await service.list(auth);
      expect(bySlug(list, 'registration-confirmation').channels).toEqual([
        'email',
        'sms',
      ]);
      const others = list.filter((t) => t.slug !== 'registration-confirmation');
      expect(others.every((t) => t.channels.length > 0)).toBe(true);
      expect(others.every((t) => t.channels.every((c) => c === 'email'))).toBe(
        true,
      );
    });
  });

  /**
   * The three messages whose handlers eventa-worker is gaining next
   * (US-REG-02 rejection, US-REG-06 invitation, US-PROG-03 session change).
   *
   * The API has been publishing `registration.rejected`, `invitation.sent` and
   * `program.session_changed` with nothing bound to them, so the topic exchange
   * discarded each one — no failure, no retry, no dead-letter, no trace. The
   * slug is what a handler reads before it sends, so it has to exist BEFORE the
   * handler does: eventa-worker answers a slug it has never heard of with ON
   * (see `defaultActive` below), which is the difference between a kill switch
   * an organizer can find and mail they cannot explain.
   */
  describe('the messages whose handlers are being built', () => {
    const SENDING_SLUGS = [
      'rejection-notice',
      'event-invitation',
      'session-change',
    ];

    const definitionOf = (slug: string): MessageTemplateDefinition => {
      const found = templateBySlug(slug);
      if (!found) throw new Error(`No catalog entry for ${slug}`);
      return found;
    };

    it.each(SENDING_SLUGS)('has an entry for %s', (slug) => {
      expect(templateBySlug(slug)).toBeDefined();
    });

    /*
     * These assertions used to say the opposite, and that is the lesson worth
     * leaving here. They pinned `planned` and pinned `assertSwitchable`
     * THROWING — written while no handler existed, and left standing after the
     * handlers landed in the same body of work. So both repos stayed green
     * while the organizer's switch was dead: `assertSwitchable` gates
     * `setActive`, `setActive` is the only writer of `message_templates.active`
     * in this API, so no row could ever be created, `activeWhenUnset` always
     * answered true, and all three emails sent unconditionally and could not be
     * stopped — under a list view that told the organizer nothing sends them.
     *
     * A test that asserts the state of the world at the moment it was written
     * does not protect the rule; it freezes the bug and then blocks the fix.
     */
    it.each(SENDING_SLUGS)(
      'calls %s controlled, because a handler sends it and reads the switch',
      (slug) => {
        expect(definitionOf(slug).delivery).toBe('controlled');
      },
    );

    it.each(SENDING_SLUGS)('lets an organizer switch %s off', (slug) => {
      expect(() => assertSwitchable(definitionOf(slug))).not.toThrow();
    });

    /*
     * The invariant rather than the snapshot: nothing in the catalog may claim
     * to be switchable without being switchable, and nothing may be called
     * `planned` while this API is willing to write its row. This fires on the
     * CONDITION, so it keeps holding as slugs are added.
     */
    it('refuses a switch exactly when nothing sends it, for every entry', () => {
      for (const definition of MESSAGE_TEMPLATE_CATALOG) {
        if (definition.delivery === 'planned') {
          expect(() => assertSwitchable(definition)).toThrow(DomainException);
        } else {
          expect(() => assertSwitchable(definition)).not.toThrow();
        }
      }
    });

    it.each(SENDING_SLUGS)(
      'starts %s on, which is what eventa-worker already answers',
      (slug) => {
        // The reason adding these slugs is not cosmetic. eventa-worker's
        // `activeWhenUnset` is a DENY-list — `!OFF_UNTIL_SWITCHED_ON_SLUGS
        // .includes(slug)` — so a slug it has never seen is ON and
        // `isActive(org, slug)` answers true for every workspace with no row.
        // `defaultActive: false` here would print "Inactive" on the page while
        // the worker mailed attendees, and fixing that would mean editing that
        // deny-list in a repo this change must not touch.
        expect(definitionOf(slug).defaultActive).toBe(true);
      },
    );

    it.each(SENDING_SLUGS)(
      'gives %s no merge fields until a handler fills them',
      (slug) => {
        // A field listed here that the worker does not substitute reaches an
        // attendee as literal braces — and `setWording` is refused for a
        // planned message anyway, so there is nothing to fill it with yet.
        expect(definitionOf(slug).tags).toEqual([]);
      },
    );

    it.each(SENDING_SLUGS)('sends %s by email only', (slug) => {
      // A channel badge is a promise that something sends on it. Nothing texts
      // these; the confirmation is still the only message with an SMS badge.
      expect(definitionOf(slug).channels).toEqual(['email']);
    });

    it('owes the attendee a rejection, and only that one of the three', () => {
      // Somebody who signed up — and may have paid — is owed the news that
      // their place was refused, the same way they are owed the news that an
      // event is off. An invitation nobody asked for, and a session that moved,
      // are not debts, so switching them off needs no warning.
      expect(definitionOf('rejection-notice').expected).toBe(true);
      expect(definitionOf('event-invitation').expected).toBe(false);
      expect(definitionOf('session-change').expected).toBe(false);
    });
  });
});

function bySlug<T extends { slug: string }>(list: T[], slug: string): T {
  const found = list.find((t) => t.slug === slug);
  if (!found) throw new Error(`No template ${slug} in the list`);
  return found;
}
