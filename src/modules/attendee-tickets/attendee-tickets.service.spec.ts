import { DomainException } from '../../common/errors/domain.exception';
import type { Clock } from '../../common/time/clock';
import type { UsersRepository } from '../users/users.repository';
import type { AttendeeTicketsRepository } from './attendee-tickets.repository';
import { AttendeeTicketsService } from './attendee-tickets.service';
import type {
  MyRegistrationRow,
  TicketPassRow,
} from './attendee-tickets.types';

const NOW = new Date('2026-06-01T05:00:00Z'); // noon in Bangkok
const USER_ID = 'u-1';
const EMAIL = 'anan@example.test';
const TICKET_ID = 't-1';

function registration(o: Partial<MyRegistrationRow> = {}): MyRegistrationRow {
  return {
    orderId: 'o-1',
    reference: 'ORD-7K2M9QX4',
    eventId: 'e-1',
    eventSlug: 'bangkok-tech-week',
    eventName: 'Bangkok Tech Week',
    startAt: new Date('2026-06-07T02:00:00Z'),
    endAt: null,
    timezone: 'Asia/Bangkok',
    venueName: 'QSNCC',
    city: 'Bangkok',
    isOnline: false,
    coverImage: null,
    ticketTypeName: 'General',
    ticketCount: 2,
    attended: false,
    ...o,
  };
}

function pass(o: Partial<TicketPassRow> = {}): TicketPassRow {
  return {
    id: TICKET_ID,
    orderId: 'o-1',
    orderReference: 'ORD-7K2M9QX4',
    qrToken: 'K7M2Q9XW4RT8V3NP6JHY5CBD',
    status: 'issued',
    holderName: 'Anan Suksawat',
    ticketLabel: 'VIP',
    eventName: 'Bangkok Tech <Week> & Friends',
    eventSlug: 'bangkok-tech-week',
    startAt: new Date('2026-06-07T02:00:00Z'),
    timezone: 'Asia/Bangkok',
    venueName: 'QSNCC',
    city: 'Bangkok',
    isOnline: false,
    seatSection: 'Stalls',
    seatRow: 'A',
    seatNumber: '12',
    siblingTicketIds: ['t-0', TICKET_ID, 't-2'],
    ...o,
  };
}

describe('AttendeeTicketsService (US-DISC-07, US-DISC-09)', () => {
  let repo: jest.Mocked<AttendeeTicketsRepository>;
  let service: AttendeeTicketsService;

  beforeEach(() => {
    repo = {
      registrationsByEmail: jest.fn().mockResolvedValue([registration()]),
      ticketByIdForEmail: jest.fn().mockResolvedValue(pass()),
    } as unknown as jest.Mocked<AttendeeTicketsRepository>;
    const users = {
      findProfile: jest
        .fn()
        .mockResolvedValue({ user: { email: EMAIL }, org: {} }),
    } as unknown as jest.Mocked<UsersRepository>;
    const clock: Clock = { now: () => NOW };
    service = new AttendeeTicketsService(repo, users, clock);
  });

  describe('myEvents — the Upcoming/Past split (US-DISC-09)', () => {
    it('keys everything off the signed-in account’s own email', async () => {
      await service.myEvents(USER_ID);
      expect(repo.registrationsByEmail).toHaveBeenCalledWith(EMAIL);
    });

    it('splits upcoming from past, with a count for each', async () => {
      repo.registrationsByEmail.mockResolvedValue([
        registration({ orderId: 'up' }),
        registration({
          orderId: 'gone',
          startAt: new Date('2026-05-20T02:00:00Z'),
        }),
      ]);
      const res = await service.myEvents(USER_ID);
      expect(res.upcoming.map((r) => r.orderId)).toEqual(['up']);
      expect(res.past.map((r) => r.orderId)).toEqual(['gone']);
      expect(res.counts).toEqual({ upcoming: 1, past: 1 });
    });

    it('keeps an event running today in Upcoming until it ends', async () => {
      repo.registrationsByEmail.mockResolvedValue([
        registration({
          startAt: new Date('2026-06-01T02:00:00Z'), // started this morning
          endAt: new Date('2026-06-01T10:00:00Z'), // ends this evening
        }),
      ]);
      const res = await service.myEvents(USER_ID);
      expect(res.counts).toEqual({ upcoming: 1, past: 0 });
      expect(res.upcoming[0].countdown).toBe('Today');
    });

    it('counts down in whole Bangkok days — "6 days left"', async () => {
      const res = await service.myEvents(USER_ID);
      expect(res.upcoming[0].countdown).toBe('6 days left');
    });

    it('says Tomorrow rather than "1 days left"', async () => {
      repo.registrationsByEmail.mockResolvedValue([
        registration({ startAt: new Date('2026-06-02T02:00:00Z') }),
      ]);
      expect((await service.myEvents(USER_ID)).upcoming[0].countdown).toBe(
        'Tomorrow',
      );
    });

    it('gives a past event no countdown, and sorts it most recent first', async () => {
      repo.registrationsByEmail.mockResolvedValue([
        registration({
          orderId: 'older',
          startAt: new Date('2026-04-01T02:00:00Z'),
        }),
        registration({
          orderId: 'newer',
          startAt: new Date('2026-05-01T02:00:00Z'),
        }),
      ]);
      const res = await service.myEvents(USER_ID);
      expect(res.past.map((r) => r.orderId)).toEqual(['newer', 'older']);
      expect(res.past[0].countdown).toBeNull();
    });

    it('sorts upcoming soonest first', async () => {
      repo.registrationsByEmail.mockResolvedValue([
        registration({
          orderId: 'later',
          startAt: new Date('2026-08-01T02:00:00Z'),
        }),
        registration({
          orderId: 'sooner',
          startAt: new Date('2026-06-10T02:00:00Z'),
        }),
      ]);
      const res = await service.myEvents(USER_ID);
      expect(res.upcoming.map((r) => r.orderId)).toEqual(['sooner', 'later']);
    });

    it('returns empty sections for an attendee with no registrations', async () => {
      repo.registrationsByEmail.mockResolvedValue([]);
      const res = await service.myEvents(USER_ID);
      expect(res).toMatchObject({
        upcoming: [],
        past: [],
        counts: { upcoming: 0, past: 0 },
      });
    });
  });

  describe('ticket — one pass (US-DISC-07)', () => {
    it('shows the QR token, reference and its place in the order', async () => {
      const res = await service.ticket(USER_ID, TICKET_ID);
      expect(res.qrToken).toBe('K7M2Q9XW4RT8V3NP6JHY5CBD');
      expect(res.reference).toBe('ORD-7K2M9QX4');
      expect(res.admissionNumber).toBe('2 of 3');
      expect(res.valid).toBe(true);
      expect(res.seat).toEqual({ section: 'Stalls', row: 'A', number: '12' });
    });

    it('is refused for a ticket the caller does not own', async () => {
      repo.ticketByIdForEmail.mockResolvedValue(null);
      const err = await service
        .ticket(USER_ID, 'someone-elses')
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(404);
    });

    it('shows a refunded ticket as no longer valid, but still shows it', async () => {
      repo.ticketByIdForEmail.mockResolvedValue(pass({ status: 'refunded' }));
      const res = await service.ticket(USER_ID, TICKET_ID);
      expect(res.valid).toBe(false);
      expect(res.status).toBe('refunded');
    });

    it('still admits a ticket already checked in — scanned is not void', async () => {
      repo.ticketByIdForEmail.mockResolvedValue(pass({ status: 'checked_in' }));
      expect((await service.ticket(USER_ID, TICKET_ID)).valid).toBe(true);
    });
  });

  describe('passSvg — the printable pass (US-DISC-07)', () => {
    it('renders one SVG carrying the QR and every printed detail', async () => {
      const svg = await service.passSvg(USER_ID, TICKET_ID);
      expect(svg).toContain('<svg');
      expect(svg).toContain('ORD-7K2M9QX4');
      expect(svg).toContain('VIP');
      expect(svg).toContain('QSNCC');
      expect(svg).toContain('2 of 3');
      // The event name is escaped, never injected raw into the markup.
      expect(svg).toContain('Bangkok Tech &lt;Week&gt; &amp; Friends');
      expect(svg).not.toContain('<Week>');
    });

    it('refuses to print a pass for a voided ticket', async () => {
      repo.ticketByIdForEmail.mockResolvedValue(pass({ status: 'void' }));
      const err = await service
        .passSvg(USER_ID, TICKET_ID)
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect((err as DomainException).message).toMatch(/no longer valid/i);
    });

    it('refuses to print a refunded ticket as a valid pass', async () => {
      repo.ticketByIdForEmail.mockResolvedValue(pass({ status: 'refunded' }));
      await expect(service.passSvg(USER_ID, TICKET_ID)).rejects.toThrow(
        DomainException,
      );
    });
  });
});
