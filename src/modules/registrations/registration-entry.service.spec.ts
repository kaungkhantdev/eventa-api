import type { AuthContext } from '../auth/auth.types';
import type {
  EnteredRegistration,
  RegistrationEntryPort,
} from './ports/registration-entry.port';
import { RegistrationEntryService } from './registration-entry.service';

const ORG = 7;
const EVENT = 'e-1';
const TIER = 't-1';

const auth: AuthContext = {
  userId: 'u-1',
  organizationId: ORG,
  sessionId: 's-1',
  persona: 'admin',
};

const placed: EnteredRegistration = {
  orderId: 'o-1',
  reference: 'ORD-2026-0009',
  status: 'confirmed',
  paymentStatus: 'paid',
  totalSatang: 0,
  vatSatang: 0,
  amountLabel: 'Free',
  ticketCount: 2,
  paymentRequired: false,
};

const body = (o: Record<string, unknown> = {}) => ({
  eventId: EVENT,
  ticketTypeId: TIER,
  quantity: 2,
  name: 'Anan Suksawat',
  email: 'anan@example.com',
  ...o,
});

describe('RegistrationEntryService (US-REG-03)', () => {
  let entries: jest.Mocked<RegistrationEntryPort>;
  let service: RegistrationEntryService;

  beforeEach(() => {
    entries = { add: jest.fn().mockResolvedValue(placed) };
    service = new RegistrationEntryService(entries);
  });

  it('books into the CALLER’s workspace, never one named in the request', async () => {
    await service.add(auth, body());
    expect(entries.add).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, createdBy: 'u-1' }),
    );
  });

  it('passes the attendee through as one person, phone included', async () => {
    await service.add(auth, body({ phone: '+66812345678' }));
    expect(entries.add).toHaveBeenCalledWith(
      expect.objectContaining({
        attendee: {
          name: 'Anan Suksawat',
          email: 'anan@example.com',
          phone: '+66812345678',
        },
      }),
    );
  });

  it('sends the confirmation by default', async () => {
    await service.add(auth, body());
    expect(entries.add).toHaveBeenCalledWith(
      expect.objectContaining({ sendConfirmation: true }),
    );
  });

  it('creates the ticket quietly when the toggle is off', async () => {
    await service.add(auth, body({ sendConfirmation: false }));
    expect(entries.add).toHaveBeenCalledWith(
      expect.objectContaining({ sendConfirmation: false }),
    );
  });

  it('carries an idempotency key, so a double-tapped Save books once', async () => {
    await service.add(auth, body());
    const [entry] = entries.add.mock.calls[0];
    expect(entry.idempotencyKey).toEqual(expect.any(String));
    expect(entry.idempotencyKey.length).toBeGreaterThan(8);
  });

  it('never carries an amount — the total is computed, not typed', async () => {
    await service.add(auth, body({ totalSatang: 999, amountLabel: '฿1.00' }));
    const [entry] = entries.add.mock.calls[0];
    expect(entry).not.toHaveProperty('totalSatang');
    expect(entry).not.toHaveProperty('amountLabel');
  });

  it('returns what was placed, including the "Free" label', async () => {
    const result = await service.add(auth, body());
    expect(result).toEqual(placed);
  });
});
