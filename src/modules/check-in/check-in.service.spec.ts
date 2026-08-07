import type { Clock } from '../../common/time/clock';
import type { AuthContext } from '../auth/auth.types';
import { CheckInService } from './check-in.service';
import type { CheckInRepository } from './check-in.repository';
import type { AdmissibleTicket } from './check-in.types';
import type { CheckInEventPort } from './ports/check-in-event.port';

const ORG = 7;
const EVENT = 'e-1';
const TICKET = 't-1';
/** Mid-event, so the door is open unless a test says otherwise. */
const NOW = new Date('2026-09-01T14:00:00Z');
const ARRIVED = new Date('2026-09-01T13:00:00Z');

const auth: AuthContext = {
  userId: 'staff-1',
  organizationId: ORG,
  sessionId: 's-1',
  persona: 'admin',
};

const ticket = (o: Partial<AdmissibleTicket> = {}): AdmissibleTicket => ({
  id: TICKET,
  eventId: EVENT,
  attendeeId: 11,
  holderName: 'Anan Suksawat',
  ticketLabel: 'General',
  status: 'issued',
  ...o,
});

describe('CheckInService (US-REG-11/12/13)', () => {
  let repo: jest.Mocked<CheckInRepository>;
  let events: jest.Mocked<CheckInEventPort>;
  let service: CheckInService;

  beforeEach(() => {
    repo = {
      findTicketByToken: jest.fn().mockResolvedValue(ticket()),
      findTicketById: jest.fn().mockResolvedValue(ticket()),
      admit: jest.fn().mockResolvedValue({ checkedInAt: NOW, inserted: true }),
      undo: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<CheckInRepository>;
    events = {
      findForCheckIn: jest.fn().mockResolvedValue({
        id: EVENT,
        status: 'live',
        startAt: new Date('2026-09-01T10:00:00Z'),
        endAt: new Date('2026-09-01T18:00:00Z'),
      }),
    };
    const clock: Clock = { now: () => NOW };
    service = new CheckInService(repo, events, clock);
  });

  const scan = (o: Record<string, unknown> = {}) =>
    service.scan(auth, EVENT, { qrToken: 'tok-1', ...o });

  describe('scanning a ticket (US-REG-12)', () => {
    it('admits a valid unused ticket for this event', async () => {
      const result = await scan();
      expect(result.outcome).toBe('admitted');
      expect(result.holderName).toBe('Anan Suksawat');
      expect(repo.admit).toHaveBeenCalledTimes(1);
    });

    it('reports the ORIGINAL arrival time on a second scan, admitting nobody twice', async () => {
      repo.admit.mockResolvedValue({ checkedInAt: ARRIVED, inserted: false });
      const result = await scan();
      expect(result.outcome).toBe('already_checked_in');
      expect(result.checkedInAt).toEqual(ARRIVED);
    });

    it('refuses a QR that is not a ticket at all', async () => {
      repo.findTicketByToken.mockResolvedValue(null);
      const result = await scan();
      expect(result.outcome).toBe('invalid');
      expect(repo.admit).not.toHaveBeenCalled();
    });

    it('refuses a real ticket belonging to a different event', async () => {
      repo.findTicketByToken.mockResolvedValue(ticket({ eventId: 'other' }));
      const result = await scan();
      expect(result.outcome).toBe('wrong_event');
      expect(repo.admit).not.toHaveBeenCalled();
    });

    it.each(['void', 'refunded'] as const)(
      'refuses a %s ticket — entry denied',
      async (status) => {
        repo.findTicketByToken.mockResolvedValue(ticket({ status }));
        const result = await scan();
        expect(result.outcome).toBe('cancelled');
        expect(repo.admit).not.toHaveBeenCalled();
      },
    );

    it('admits a ticket already marked checked_in — the ledger decides, not the flag', async () => {
      // `tickets.status` is a projection of `check_ins`; if they disagree the
      // ledger wins, and the insert reports which it was.
      repo.findTicketByToken.mockResolvedValue(
        ticket({ status: 'checked_in' }),
      );
      repo.admit.mockResolvedValue({ checkedInAt: ARRIVED, inserted: false });
      const result = await scan();
      expect(result.outcome).toBe('already_checked_in');
    });

    it('refuses when the door is shut, without touching the ledger', async () => {
      events.findForCheckIn.mockResolvedValue({
        id: EVENT,
        status: 'draft',
        startAt: new Date('2026-09-01T10:00:00Z'),
        endAt: null,
      });
      await expect(scan()).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(repo.admit).not.toHaveBeenCalled();
    });

    it('refuses an event from another workspace', async () => {
      events.findForCheckIn.mockResolvedValue(null);
      await expect(scan()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('records who admitted them, how, and at which station', async () => {
      await service.scan(auth, EVENT, {
        qrToken: 'tok-1',
        stationId: 'door-2',
      });
      expect(repo.admit).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG,
          eventId: EVENT,
          ticketId: TICKET,
          method: 'qr',
          checkedInBy: 'staff-1',
          stationId: 'door-2',
        }),
      );
    });
  });

  describe('admitting by hand (US-REG-13)', () => {
    it('admits by ticket id, recorded as a manual entry', async () => {
      const result = await service.admitManually(auth, EVENT, {
        ticketId: TICKET,
      });
      expect(result.outcome).toBe('admitted');
      expect(repo.admit).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'manual' }),
      );
    });

    it('is idempotent in exactly the way a scan is', async () => {
      repo.admit.mockResolvedValue({ checkedInAt: ARRIVED, inserted: false });
      const result = await service.admitManually(auth, EVENT, {
        ticketId: TICKET,
      });
      expect(result.outcome).toBe('already_checked_in');
      expect(result.checkedInAt).toEqual(ARRIVED);
    });

    it('refuses a ticket that is not on this event', async () => {
      repo.findTicketById.mockResolvedValue(ticket({ eventId: 'other' }));
      const result = await service.admitManually(auth, EVENT, {
        ticketId: TICKET,
      });
      expect(result.outcome).toBe('wrong_event');
    });

    it('records an upload-decoded admission as its own method', async () => {
      await service.admitManually(auth, EVENT, {
        ticketId: TICKET,
        method: 'upload',
      });
      expect(repo.admit).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'upload' }),
      );
    });
  });

  describe('undoing a check-in (US-REG-11)', () => {
    it('clears the admission so the not-yet count rises again', async () => {
      await service.undo(auth, EVENT, TICKET);
      expect(repo.undo).toHaveBeenCalledWith(
        ORG,
        EVENT,
        TICKET,
        expect.objectContaining({ undoneBy: 'staff-1' }),
      );
    });

    it('refuses to undo something that was never checked in', async () => {
      repo.undo.mockResolvedValue(false);
      await expect(service.undo(auth, EVENT, TICKET)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });
});
