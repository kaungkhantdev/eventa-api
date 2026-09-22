import { DomainException } from '../../common/errors/domain.exception';
import { MESSAGE_TEMPLATE_CATALOG } from './message-template-catalog';
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
      // Every message in today's catalog is sent, so this is proved on one
      // made up for the purpose: the rule has to outlive the day the last
      // planned message shipped, because the next one will be added planned.
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

    it('offers no channel the product cannot deliver on', async () => {
      // There is no SMS provider yet, so an SMS badge would be a promise.
      const list = await service.list(auth);
      expect(list.every((t) => t.channels.every((c) => c === 'email'))).toBe(
        true,
      );
    });
  });
});

function bySlug<T extends { slug: string }>(list: T[], slug: string): T {
  const found = list.find((t) => t.slug === slug);
  if (!found) throw new Error(`No template ${slug} in the list`);
  return found;
}
