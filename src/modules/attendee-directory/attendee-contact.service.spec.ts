import { DrizzleQueryError } from 'drizzle-orm';
import { ErrorCode } from '../../common/errors/error-codes';
import { DomainException } from '../../common/errors/domain.exception';
import { AttendeeContactService } from './attendee-contact.service';
import { AttendeeDirectoryRepository } from './attendee-directory.repository';
import type {
  AttendeeContactRow,
  AttendeeRow,
  SaveContactInput,
} from './attendee-directory.types';
import type { AuthContext } from '../auth/auth.types';

const ORG = 7;
const ATTENDEE = 42;
const ACTOR = '11111111-1111-4111-8111-111111111111';

const auth = { organizationId: ORG, userId: ACTOR } as AuthContext;

function contact(
  overrides: Partial<AttendeeContactRow> = {},
): AttendeeContactRow {
  return {
    id: ATTENDEE,
    name: 'Anan Suksawat',
    email: 'anan@example.com',
    phone: '+66812345678',
    version: 3,
    ...overrides,
  };
}

function directoryRow(overrides: Partial<AttendeeRow> = {}): AttendeeRow {
  return {
    id: ATTENDEE,
    name: 'Anan Suksawat',
    email: 'anan@example.com',
    phone: '+66812345678',
    company: null,
    tag: 'VIP',
    firstSeenAt: new Date('2026-01-01T00:00:00Z'),
    lastActivityAt: null,
    eventCount: 1,
    ticketCount: 2,
    checkedInCount: 1,
    // The version the row is read at, which the entry now carries out so the
    // next save can be guarded by it.
    version: 3,
    ...overrides,
  };
}

describe('AttendeeContactService (US-REG-08)', () => {
  let repo: jest.Mocked<AttendeeDirectoryRepository>;
  let service: AttendeeContactService;
  let saved: SaveContactInput | undefined;

  beforeEach(() => {
    saved = undefined;
    repo = {
      findContact: jest.fn().mockResolvedValue(contact()),
      findAttendeeIdByEmail: jest.fn().mockResolvedValue(null),
      findDirectoryEntry: jest.fn().mockResolvedValue(directoryRow()),
      saveContact: jest
        .fn()
        .mockImplementation(
          (_org: number, _id: number, input: SaveContactInput) => {
            saved = input;
            return Promise.resolve(directoryRow({ ...input.changes }));
          },
        ),
    } as unknown as jest.Mocked<AttendeeDirectoryRepository>;
    service = new AttendeeContactService(repo);
  });

  describe('a valid change (AC1)', () => {
    it('saves the new details and answers with the refreshed directory row', async () => {
      const row = await service.updateContact(auth, ATTENDEE, {
        name: 'Anan Suksawat-Pinto',
        email: 'anan.sp@example.com',
        phone: '+66891112222',
      });

      expect(row).toMatchObject({
        id: ATTENDEE,
        name: 'Anan Suksawat-Pinto',
        email: 'anan.sp@example.com',
        phone: '+66891112222',
        // The aggregates the directory row carries come back with it, so the
        // console can repaint the row from the response alone.
        ticketCount: 2,
        checkedInCount: 1,
      });
      expect(saved?.changes).toEqual({
        name: 'Anan Suksawat-Pinto',
        email: 'anan.sp@example.com',
        phone: '+66891112222',
      });
    });

    it('trims what the organizer typed and guards the write with the row’s own version', async () => {
      await service.updateContact(auth, ATTENDEE, { name: '  Malee Chai  ' });

      expect(saved?.changes).toEqual({ name: 'Malee Chai' });
      expect(saved?.expectedVersion).toBe(3);
      expect(saved?.actorUserId).toBe(ACTOR);
    });

    it('clears the phone when the organizer empties the field', async () => {
      await service.updateContact(auth, ATTENDEE, { phone: '   ' });

      expect(saved?.changes).toEqual({ phone: null });
      expect(saved?.fields).toEqual(['phone']);
    });

    it('leaves out a field whose value is already what was typed', async () => {
      await service.updateContact(auth, ATTENDEE, {
        name: 'Anan Suksawat',
        phone: '+66891112222',
      });

      expect(saved?.changes).toEqual({ phone: '+66891112222' });
      expect(saved?.fields).toEqual(['phone']);
    });
  });

  describe('the audit trail (AC1 + AC5)', () => {
    it('names the changed fields, newest-first order aside, for the timeline entry', async () => {
      await service.updateContact(auth, ATTENDEE, {
        email: 'anan.sp@example.com',
        phone: '+66891112222',
      });

      expect(saved?.fields).toEqual(['email', 'phone']);
    });

    it('writes nothing at all when the save moves no value', async () => {
      const row = await service.updateContact(auth, ATTENDEE, {
        name: 'Anan Suksawat',
        email: 'anan@example.com',
        phone: '+66812345678',
      });

      expect(repo.saveContact).not.toHaveBeenCalled();
      expect(repo.findDirectoryEntry).toHaveBeenCalledWith(ORG, ATTENDEE);
      expect(row.email).toBe('anan@example.com');
    });
  });

  describe('an address another attendee already holds (AC3)', () => {
    it('blocks the change and prompts a merge rather than overwriting', async () => {
      repo.findAttendeeIdByEmail.mockResolvedValue({ id: 99, removed: false });

      const refusal = await service
        .updateContact(auth, ATTENDEE, { email: 'malee@example.com' })
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(DomainException);
      const refused = refusal as DomainException;
      expect(refused.getStatus()).toBe(409);
      expect(refused.code).toBe(ErrorCode.ATTENDEE_EMAIL_IN_USE);
      expect(refused.message).toMatch(/merge/i);
      // Nothing is applied — not the email, and not the name sent with it.
      expect(repo.saveContact).not.toHaveBeenCalled();
    });

    it('says so differently when the holder is a removed record', async () => {
      repo.findAttendeeIdByEmail.mockResolvedValue({ id: 99, removed: true });

      const refused = (await service
        .updateContact(auth, ATTENDEE, { email: 'gone@example.com' })
        .catch((error: unknown) => error)) as DomainException;

      expect(refused.code).toBe(ErrorCode.ATTENDEE_EMAIL_IN_USE);
      expect(refused.message).toMatch(/removed/i);
    });

    it('never names the other person in the message, which is logged', async () => {
      repo.findAttendeeIdByEmail.mockResolvedValue({ id: 99, removed: false });

      const refused = (await service
        .updateContact(auth, ATTENDEE, { email: 'malee@example.com' })
        .catch((error: unknown) => error)) as DomainException;

      expect(refused.message).not.toMatch(/malee@example\.com/);
    });

    it('lets the attendee keep their own address, in any capitalisation', async () => {
      repo.findAttendeeIdByEmail.mockResolvedValue({
        id: ATTENDEE,
        removed: false,
      });

      const row = await service.updateContact(auth, ATTENDEE, {
        email: 'Anan@Example.com',
      });

      expect(row.email).toBe('Anan@Example.com');
      expect(saved?.changes).toEqual({ email: 'Anan@Example.com' });
    });

    it('answers the index’s own refusal with the same merge prompt, not a 500', async () => {
      // The shape the driver stack really throws: drizzle wraps the pg error,
      // and pg names the index on `constraint` — not `constraint_name`, which
      // this test used to invent. With the invented shape the assertion passed
      // while the guard it was covering could never match a real violation, so
      // a genuine race answered 500 and logged the bound params, this person's
      // name and address among them. See `common/errors/unique-violation.ts`.
      repo.saveContact.mockRejectedValue(
        new DrizzleQueryError(
          'update "attendees" set "email" = $1 where "id" = $2',
          ['malee@example.com', String(ATTENDEE)],
          Object.assign(new Error('duplicate key value'), {
            code: '23505',
            constraint: 'uq_attendees_org_email',
          }),
        ),
      );

      const refused = (await service
        .updateContact(auth, ATTENDEE, { email: 'malee@example.com' })
        .catch((error: unknown) => error)) as DomainException;

      expect(refused).toBeInstanceOf(DomainException);
      expect(refused.getStatus()).toBe(409);
      expect(refused.code).toBe(ErrorCode.ATTENDEE_EMAIL_IN_USE);
    });

    it('does not swallow an unrelated database failure', async () => {
      const boom = new Error('connection terminated');
      repo.saveContact.mockRejectedValue(boom);

      await expect(
        service.updateContact(auth, ATTENDEE, { email: 'new@example.com' }),
      ).rejects.toBe(boom);
    });
  });

  describe('invalid input (AC4)', () => {
    it('refuses a name that is only whitespace, naming the field', async () => {
      const refused = (await service
        .updateContact(auth, ATTENDEE, { name: '   ' })
        .catch((error: unknown) => error)) as DomainException;

      expect(refused.getStatus()).toBe(422);
      expect(refused.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(refused.errors).toHaveLength(1);
      expect(refused.errors?.[0].field).toBe('name');
      expect(refused.errors?.[0].message).toMatch(/name/i);
      expect(repo.saveContact).not.toHaveBeenCalled();
    });

    it('refuses a save that names no field to change', async () => {
      const refused = (await service
        .updateContact(auth, ATTENDEE, {})
        .catch((error: unknown) => error)) as DomainException;

      expect(refused.getStatus()).toBe(422);
      expect(repo.saveContact).not.toHaveBeenCalled();
    });
  });

  describe('the record itself', () => {
    it('404s for an attendee this workspace does not have', async () => {
      repo.findContact.mockResolvedValue(null);

      const refused = (await service
        .updateContact(auth, ATTENDEE, { name: 'Anybody' })
        .catch((error: unknown) => error)) as DomainException;

      expect(refused.getStatus()).toBe(404);
      expect(repo.findContact).toHaveBeenCalledWith(ORG, ATTENDEE);
    });

    it('409s when the form was opened before someone else’s edit', async () => {
      const refused = (await service
        .updateContact(auth, ATTENDEE, { name: 'Anybody', version: 2 })
        .catch((error: unknown) => error)) as DomainException;

      expect(refused.getStatus()).toBe(409);
      expect(refused.code).toBe(ErrorCode.CONFLICT);
      expect(repo.saveContact).not.toHaveBeenCalled();
    });

    it('409s when the row moves between the read and the guarded write', async () => {
      repo.saveContact.mockResolvedValue(null);

      const refused = (await service
        .updateContact(auth, ATTENDEE, { name: 'Anybody' })
        .catch((error: unknown) => error)) as DomainException;

      expect(refused.getStatus()).toBe(409);
      expect(refused.code).toBe(ErrorCode.CONFLICT);
    });
  });
});
