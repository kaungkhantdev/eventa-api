import { DomainException } from '../../common/errors/domain.exception';
import { EventsService } from '../events/events.service';
import { SessionsRepository } from './sessions.repository';
import { SessionsService } from './sessions.service';
import type { SessionRow } from './sessions.types';

const actor = { organizationId: 1, userId: 'u1' };
const eventId = 'e1';

function sessionRow(o: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 'ss1',
    organizationId: 1,
    eventId: 'e1',
    day: 1,
    startTime: '09:00:00',
    endTime: '10:00:00',
    title: 'Opening',
    type: 'Keynote',
    room: 'Main Hall',
    color: null,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    version: 1,
    ...o,
  };
}

describe('SessionsService', () => {
  let repo: jest.Mocked<SessionsRepository>;
  let events: jest.Mocked<EventsService>;
  let service: SessionsService;

  beforeEach(() => {
    repo = {
      createWithSpeakers: jest
        .fn()
        .mockImplementation((v: Partial<SessionRow>) =>
          Promise.resolve(sessionRow(v)),
        ),
      listByEvent: jest.fn().mockResolvedValue([]),
      findSession: jest.fn().mockResolvedValue(sessionRow()),
      updateWithSpeakers: jest
        .fn()
        .mockImplementation((_o: number, _id: string, v: Partial<SessionRow>) =>
          Promise.resolve(sessionRow({ ...v, version: 2 })),
        ),
      softDelete: jest.fn().mockResolvedValue(true),
      validSpeakerIds: jest
        .fn()
        .mockImplementation((_o: number, _e: string, ids: string[]) =>
          Promise.resolve(ids),
        ),
      speakersFor: jest.fn().mockResolvedValue(new Map()),
      sameRoomSessions: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<SessionsRepository>;
    events = {
      getEvent: jest.fn().mockResolvedValue({ id: eventId }),
    } as unknown as jest.Mocked<EventsService>;
    service = new SessionsService(repo, events);
  });

  describe('createSession', () => {
    it('verifies the event, inserts, and returns the session', async () => {
      const res = await service.createSession(actor, eventId, {
        day: 1,
        startTime: '09:00',
        title: 'Opening',
        type: 'Keynote',
      });
      expect(events.getEvent).toHaveBeenCalledWith(actor, eventId);
      expect(repo.createWithSpeakers).toHaveBeenCalledTimes(1);
      expect(res).toMatchObject({ title: 'Opening', warning: null });
    });

    it('requires a non-blank title (422)', async () => {
      const err = await service
        .createSession(actor, eventId, {
          day: 1,
          startTime: '09:00',
          title: '  ',
          type: 'Talk',
        })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
      expect(repo.createWithSpeakers).not.toHaveBeenCalled();
    });

    it('rejects an end time not after the start (422)', async () => {
      const err = await service
        .createSession(actor, eventId, {
          day: 1,
          startTime: '10:00',
          endTime: '10:00',
          title: 'Zero length',
          type: 'Talk',
        })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
      expect(repo.createWithSpeakers).not.toHaveBeenCalled();
    });

    it('accepts a valid sub-minute interval (seconds precision)', async () => {
      await expect(
        service.createSession(actor, eventId, {
          day: 1,
          startTime: '09:00:20',
          endTime: '09:00:40',
          title: 'Lightning',
          type: 'Talk',
        }),
      ).resolves.toBeDefined();
      expect(repo.createWithSpeakers).toHaveBeenCalledTimes(1);
    });

    it('rejects a speaker that is not on the event (422)', async () => {
      repo.validSpeakerIds.mockResolvedValue(['sp1']); // 'sp2' missing
      const err = await service
        .createSession(actor, eventId, {
          day: 1,
          startTime: '09:00',
          title: 'Panel',
          type: 'Panel',
          speakerIds: ['sp1', 'sp2'],
        })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
      expect(repo.createWithSpeakers).not.toHaveBeenCalled();
    });

    it('persists the session and its speaker links atomically (one repo call)', async () => {
      await service.createSession(actor, eventId, {
        day: 1,
        startTime: '09:00',
        title: 'Panel',
        type: 'Panel',
        speakerIds: ['sp1', 'sp2'],
      });
      expect(repo.createWithSpeakers).toHaveBeenCalledTimes(1);
      expect(repo.createWithSpeakers.mock.calls[0][1]).toEqual(['sp1', 'sp2']);
    });

    it('warns (but does not block) when a same-room session overlaps', async () => {
      repo.sameRoomSessions.mockResolvedValue([
        sessionRow({
          id: 'other',
          title: 'Clashing Talk',
          startTime: '09:30:00',
          endTime: '10:30:00',
        }),
      ]);
      const res = await service.createSession(actor, eventId, {
        day: 1,
        startTime: '09:00',
        endTime: '10:00',
        title: 'Opening',
        type: 'Keynote',
        room: 'Main Hall',
      });
      expect(res.warning).toMatch(/Clashing Talk/);
      expect(repo.createWithSpeakers).toHaveBeenCalledTimes(1); // not blocked
    });

    it('does not warn when the overlapping session is in a different room', async () => {
      // Repo only returns same-room sessions; an empty result = no clash.
      repo.sameRoomSessions.mockResolvedValue([]);
      const res = await service.createSession(actor, eventId, {
        day: 1,
        startTime: '09:00',
        endTime: '10:00',
        title: 'Opening',
        type: 'Keynote',
        room: 'Room B',
      });
      expect(res.warning).toBeNull();
    });

    it('detects a sub-minute overlap (seconds precision)', async () => {
      repo.sameRoomSessions.mockResolvedValue([
        sessionRow({
          id: 'other',
          title: 'Micro Talk',
          startTime: '09:00:10',
          endTime: '09:00:50',
        }),
      ]);
      const res = await service.createSession(actor, eventId, {
        day: 1,
        startTime: '09:00:20',
        endTime: '09:00:40',
        title: 'Nested',
        type: 'Talk',
        room: 'Main Hall',
      });
      expect(res.warning).toMatch(/Micro Talk/);
    });
  });

  describe('updateSession', () => {
    it('throws 404 when the session is absent', async () => {
      repo.findSession.mockResolvedValue(null);
      const err = await service
        .updateSession(actor, eventId, 'missing', { title: 'X' })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(404);
      expect(repo.updateWithSpeakers).not.toHaveBeenCalled();
    });

    it('rejects a stale version (409)', async () => {
      const err = await service
        .updateSession(actor, eventId, 'ss1', { title: 'X', version: 99 })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect(repo.updateWithSpeakers).not.toHaveBeenCalled();
    });

    it('applies the change and returns the session', async () => {
      const res = await service.updateSession(actor, eventId, 'ss1', {
        title: 'Renamed',
      });
      expect(repo.updateWithSpeakers).toHaveBeenCalled();
      expect(res).toMatchObject({ title: 'Renamed' });
    });

    it('surfaces a lost update race (repo returns null) as 409', async () => {
      repo.updateWithSpeakers.mockResolvedValue(null);
      const err = await service
        .updateSession(actor, eventId, 'ss1', { title: 'X' })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
    });
  });

  describe('deleteSession', () => {
    it('soft-deletes an existing session', async () => {
      await service.deleteSession(actor, eventId, 'ss1');
      expect(repo.softDelete).toHaveBeenCalledWith(1, 'ss1');
    });

    it('throws 404 when the session is absent', async () => {
      repo.findSession.mockResolvedValue(null);
      const err = await service
        .deleteSession(actor, eventId, 'missing')
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(404);
    });
  });
});
