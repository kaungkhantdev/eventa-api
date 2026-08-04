import { DomainException } from '../../common/errors/domain.exception';
import type { ProfileService } from '../users/profile.service';
import { NotificationPreferencesRepository } from './notification-preferences.repository';
import { NotificationPreferencesService } from './notification-preferences.service';

const auth = { organizationId: 1, userId: 'u1', sessionId: 's1' };
const attendee = { ...auth, persona: 'attendee' };

describe('NotificationPreferencesService (US-SET-06)', () => {
  let repo: jest.Mocked<NotificationPreferencesRepository>;
  let profile: jest.Mocked<ProfileService>;
  let service: NotificationPreferencesService;

  const withPhone = (phone: string | null) =>
    profile.get.mockResolvedValue({ phone } as Awaited<
      ReturnType<ProfileService['get']>
    >);

  beforeEach(() => {
    repo = {
      list: jest.fn().mockResolvedValue([]),
      set: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<NotificationPreferencesRepository>;
    profile = { get: jest.fn() } as unknown as jest.Mocked<ProfileService>;
    withPhone('+66812345678');
    service = new NotificationPreferencesService(repo, profile);
  });

  it('lists every topic with email on and SMS off by default', async () => {
    const res = await service.list(auth);
    expect(res.length).toBeGreaterThan(0);
    expect(res.every((p) => p.emailEnabled)).toBe(true);
    expect(res.every((p) => !p.smsEnabled)).toBe(true);
  });

  it('reflects a stored choice over the default', async () => {
    repo.list.mockResolvedValue([
      { category: 'payment', emailEnabled: false, smsEnabled: true },
    ] as Awaited<ReturnType<NotificationPreferencesRepository['list']>>);
    const res = await service.list(auth);
    const payment = res.find((p) => p.category === 'payment');
    expect(payment).toMatchObject({ emailEnabled: false, smsEnabled: true });
  });

  it('marks SMS unavailable when no phone is on file', async () => {
    withPhone(null);
    const res = await service.list(auth);
    expect(res.every((p) => !p.smsAvailable)).toBe(true);
  });

  it('turns a topic off', async () => {
    await service.set(auth, 'payment', { emailEnabled: false });
    expect(repo.set).toHaveBeenCalledWith(1, 'u1', 'payment', {
      emailEnabled: false,
    });
  });

  it('refuses to turn SMS on without a phone number', async () => {
    withPhone(null);
    await expect(
      service.set(auth, 'payment', { smsEnabled: true }),
    ).rejects.toBeInstanceOf(DomainException);
    expect(repo.set).not.toHaveBeenCalled();
  });

  // US-DISC-12: each audience sees — and may toggle — only its own topics.
  it('shows an attendee reminders and marketing, never payout alerts', async () => {
    const res = await service.list(attendee as never);
    expect(res.map((r) => r.category)).toEqual(['reminder', 'marketing']);
  });

  it('keeps attendee topics out of the organizer list', async () => {
    const categories = (await service.list(auth)).map((r) => r.category);
    expect(categories).not.toContain('marketing');
    expect(categories).not.toContain('reminder');
    expect(categories).toContain('payout');
  });

  it('lets an attendee switch marketing off', async () => {
    await service.set(attendee as never, 'marketing', { emailEnabled: false });
    expect(repo.set).toHaveBeenCalledWith(1, 'u1', 'marketing', {
      emailEnabled: false,
    });
  });

  it("refuses a topic that isn't the caller's to toggle", async () => {
    await expect(
      service.set(attendee as never, 'payout', { emailEnabled: false }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(repo.set).not.toHaveBeenCalled();
  });
});
