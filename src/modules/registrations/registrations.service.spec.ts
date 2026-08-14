import type { AuthContext } from '../auth/auth.types';
import type { PermissionsService } from '../access/permissions.service';
import type { RegistrationsRepository } from './registrations.repository';
import { RegistrationsService } from './registrations.service';
import type { RegistrationRow } from './registrations.types';

const ORG = 7;
const BAHT = 100;

const auth: AuthContext = {
  userId: 'u-1',
  organizationId: ORG,
  sessionId: 's-1',
  persona: 'admin',
};

const row = (o: Partial<RegistrationRow> = {}): RegistrationRow => ({
  id: 'o-1',
  reference: 'ORD-2026-0009',
  eventId: 'e-1',
  eventName: 'Bangkok Tech Week',
  buyerName: 'Anan Suksawat',
  buyerEmail: 'anan@example.com',
  status: 'pending',
  paymentStatus: 'pending',
  seats: 2,
  totalSatang: 1_880 * BAHT,
  ticketTypeName: 'VIP',
  registeredAt: new Date('2026-06-01T00:00:00Z'),
  confirmedAt: null,
  rejectedAt: null,
  cancelledAt: null,
  ...o,
});

describe('RegistrationsService (US-REG-01)', () => {
  let repo: jest.Mocked<RegistrationsRepository>;
  let permissions: jest.Mocked<PermissionsService>;
  let service: RegistrationsService;

  beforeEach(() => {
    repo = {
      page: jest.fn().mockResolvedValue({ items: [row()], total: 1 }),
      countByStatus: jest.fn().mockResolvedValue({
        pending: 3,
        confirmed: 9,
        waitlisted: 1,
        cancelled: 2,
        rejected: 1,
      }),
    } as unknown as jest.Mocked<RegistrationsRepository>;
    permissions = {
      getFor: jest.fn().mockResolvedValue(['regView', 'finView']),
    } as unknown as jest.Mocked<PermissionsService>;
    service = new RegistrationsService(repo, permissions);
  });

  const list = (o: Record<string, unknown> = {}) => service.list(auth, o);

  it('counts every status across the WHOLE queue, not just this page', async () => {
    const result = await list({ status: 'pending', page: 2 });
    expect(repo.countByStatus).toHaveBeenCalledWith(
      ORG,
      expect.not.objectContaining({ status: 'pending' }),
    );
    expect(result.counts.confirmed).toBe(9);
  });

  it('keeps the search in the counts so the tabs match what is listed', async () => {
    await list({ search: 'Anan', status: 'pending' });
    expect(repo.countByStatus).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ search: 'Anan' }),
    );
  });

  it('passes the event filter through', async () => {
    await list({ eventId: 'e-1' });
    expect(repo.page).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ eventId: 'e-1' }),
    );
  });

  describe('money is a separate privilege', () => {
    it('shows the amount to a caller with finance access', async () => {
      const [item] = (await list()).page.items;
      expect(item.totalSatang).toBe(1_880 * BAHT);
      expect(item.amountLabel).toBe('฿1,880');
    });

    it('MASKS the amount from a caller without it', async () => {
      permissions.getFor.mockResolvedValue(['regView']);
      const [item] = (await list()).page.items;
      // Null, not 0 — "you may not see this" is not "it was free".
      expect(item.totalSatang).toBeNull();
      expect(item.amountLabel).toBeNull();
      // …while everything else about the registration still shows.
      expect(item.buyerName).toBe('Anan Suksawat');
      expect(item.seats).toBe(2);
    });

    it('reads a free registration as Free rather than ฿0', async () => {
      repo.page.mockResolvedValue({
        items: [row({ totalSatang: 0 })],
        total: 1,
      });
      expect((await list()).page.items[0].amountLabel).toBe('Free');
    });
  });

  describe('which ticket the registration is for (US-REG-01)', () => {
    it('names the tier, so the queue says what was bought', async () => {
      expect((await list()).page.items[0].ticketTypeName).toBe('VIP');
    });

    it('lists every tier of a mixed order rather than picking one', async () => {
      repo.page.mockResolvedValue({
        items: [row({ ticketTypeName: 'Early Bird, VIP' })],
        total: 1,
      });
      expect((await list()).page.items[0].ticketTypeName).toBe('Early Bird, VIP');
    });

    it('is null when the tier has been deleted, not an empty string', async () => {
      // The order still exists and must still appear in the queue; the console
      // renders a dash rather than a blank cell that reads as a bug.
      repo.page.mockResolvedValue({
        items: [row({ ticketTypeName: null })],
        total: 1,
      });
      expect((await list()).page.items[0].ticketTypeName).toBeNull();
    });

    it('shows the tier to a caller without finance access', async () => {
      // What was bought is not a money privilege — only its price is.
      permissions.getFor.mockResolvedValue(['regView']);
      const [item] = (await list()).page.items;
      expect(item.ticketTypeName).toBe('VIP');
      expect(item.totalSatang).toBeNull();
    });
  });

  describe('what each row offers', () => {
    it('offers approve and reject on a free pending registration', async () => {
      repo.page.mockResolvedValue({
        items: [row({ totalSatang: 0 })],
        total: 1,
      });
      const [item] = (await list()).page.items;
      expect(item.canApprove).toBe(true);
      expect(item.canReject).toBe(true);
    });

    it('explains why an unpaid paid registration cannot be approved', async () => {
      const [item] = (await list()).page.items;
      expect(item.canApprove).toBe(false);
      expect(item.approveBlockedReason).toMatch(/Payment isn't complete/);
    });

    it('points a captured registration at the refund instead of reject', async () => {
      repo.page.mockResolvedValue({
        items: [row({ paymentStatus: 'paid' })],
        total: 1,
      });
      const [item] = (await list()).page.items;
      expect(item.canReject).toBe(false);
      expect(item.rejectBlockedReason).toMatch(/refund/i);
    });

    it('offers neither on a rejected registration', async () => {
      repo.page.mockResolvedValue({
        items: [row({ status: 'rejected' })],
        total: 1,
      });
      const [item] = (await list()).page.items;
      expect(item.canApprove).toBe(false);
      expect(item.canReject).toBe(false);
    });
  });
});
