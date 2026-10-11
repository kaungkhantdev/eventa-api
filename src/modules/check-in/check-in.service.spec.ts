import type { Clock } from '../../common/time/clock';
import type { AuthContext } from '../auth/auth.types';
import { CheckInService } from './check-in.service';
import type { CheckInRepository } from './check-in.repository';
import { fingerprintScanToken } from './scan-token-fingerprint';
import type { AdmissibleTicket } from './check-in.types';
import type { CheckInEventPort } from './ports/check-in-event.port';

const ORG = 7;
const EVENT = 'e-1';
const TICKET = 't-1';
const TOKEN = 'tok-1';
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
      recordScanAttempt: jest.fn().mockResolvedValue(undefined),
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
    service.scan(auth, EVENT, { qrToken: TOKEN, ...o });

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

    it('leaves the ledger alone — an undo is not a scan', async () => {
      // `scan_attempts` records what the door DID. The `admitted` row stands
      // because the scan happened; "who undid what" is an `audit_events`
      // question, and a synthetic ledger row would make the refusal counts lie.
      await service.undo(auth, EVENT, TICKET);
      expect(repo.recordScanAttempt).not.toHaveBeenCalled();
    });
  });

  describe('the refused-scan ledger (`scan_attempts`)', () => {
    /** The only argument `recordScanAttempt` was given. */
    const recorded = () => repo.recordScanAttempt.mock.calls[0][0];

    it('records an unknown code with no ticket to point at', async () => {
      repo.findTicketByToken.mockResolvedValue(null);
      await scan({ stationId: 'door-2' });
      expect(repo.recordScanAttempt).toHaveBeenCalledTimes(1);
      expect(recorded()).toMatchObject({
        organizationId: ORG,
        eventId: EVENT,
        outcome: 'invalid',
        method: 'qr',
        ticketId: null,
        stationId: 'door-2',
        scannedBy: 'staff-1',
        scannedAt: NOW,
      });
    });

    it('records WHICH event a wrong-event pass belonged to', async () => {
      // The one datum `wrong_event` is about: erd.md proposed it as
      // `check_ins.other_event_id`, which the UNIQUE(ticket_id) had no room
      // for. On the ledger it costs nothing.
      repo.findTicketByToken.mockResolvedValue(ticket({ eventId: 'other' }));
      await scan();
      expect(recorded()).toMatchObject({
        outcome: 'wrong_event',
        ticketId: TICKET,
        ticketEventId: 'other',
      });
    });

    it('records a cancelled pass without repeating this station’s event', async () => {
      // Null, not `EVENT`: `ticket_event_id IS NOT NULL` has to mean "a pass
      // for somewhere else turned up here", and it cannot if every refusal
      // fills the column in with the event we already know.
      repo.findTicketByToken.mockResolvedValue(ticket({ status: 'refunded' }));
      await scan();
      expect(recorded()).toMatchObject({
        outcome: 'cancelled',
        ticketId: TICKET,
        ticketEventId: null,
      });
    });

    it('records the FINGERPRINT of the code, never the code itself', async () => {
      // `tickets.qr_token` is a bearer credential. The ledger is append-only,
      // outlives the ticket and is read by anyone who may review the door, so
      // a raw token in it would be a working pass.
      repo.findTicketByToken.mockResolvedValue(null);
      await scan();
      const { tokenFingerprint } = recorded();
      expect(tokenFingerprint).toBe(fingerprintScanToken(TOKEN));
      expect(JSON.stringify(recorded())).not.toContain(TOKEN);
    });

    it('records a manual admission with no fingerprint — no code was presented', async () => {
      // A null fingerprint is how the ledger shows staff found someone by name
      // rather than reading anything.
      await service.admitManually(auth, EVENT, { ticketId: TICKET });
      expect(repo.admit).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'manual', tokenFingerprint: null }),
      );
    });

    it('hands the admitting path the fingerprint, so an ADMISSION is logged too', async () => {
      // The ledger is every scan, not only the refused ones: without the
      // admissions in it there is no denominator, and a refusal rate cannot be
      // read off a table of refusals alone.
      await scan();
      expect(repo.admit).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenFingerprint: fingerprintScanToken(TOKEN),
        }),
      );
      // The admission and its ledger row are written together, inside
      // `admit`'s own transaction — never as a second call that could be lost.
      expect(repo.recordScanAttempt).not.toHaveBeenCalled();
    });

    it('writes nothing when the door is shut — no scan was ever made', async () => {
      events.findForCheckIn.mockResolvedValue({
        id: EVENT,
        status: 'draft',
        startAt: new Date('2026-09-01T10:00:00Z'),
        endAt: null,
      });
      await expect(scan()).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(repo.recordScanAttempt).not.toHaveBeenCalled();
    });

    it('surfaces a failed ledger write instead of swallowing it', async () => {
      // A ledger that drops rows is worse than none: it reads as a quiet
      // night. The failure surfaces rather than being swallowed.
      repo.findTicketByToken.mockResolvedValue(null);
      repo.recordScanAttempt.mockRejectedValue(new Error('ledger down'));
      await expect(scan()).rejects.toThrow('ledger down');
    });
  });
});
