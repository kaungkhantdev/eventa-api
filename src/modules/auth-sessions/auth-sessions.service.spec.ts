import { DomainException } from '../../common/errors/domain.exception';
import { AuthSessionsRepository } from './auth-sessions.repository';
import { AuthSessionsService } from './auth-sessions.service';
import type { SessionRow } from './auth-sessions.types';

const auth = { organizationId: 1, userId: 'u1', sessionId: 'current' };

function row(id: string, over: Partial<SessionRow> = {}): SessionRow {
  return {
    id,
    organizationId: 1,
    userId: 'u1',
    device: 'Chrome on Mac',
    ipAddress: '203.0.113.9',
    createdAt: new Date('2026-07-30T00:00:00Z'),
    expiresAt: new Date('2026-08-30T00:00:00Z'),
    revokedAt: null,
    ...over,
  } as SessionRow;
}

describe('AuthSessionsService (US-SET-04 / US-ACC-09)', () => {
  let repo: jest.Mocked<AuthSessionsRepository>;
  let service: AuthSessionsService;

  beforeEach(() => {
    repo = {
      listLive: jest.fn().mockResolvedValue([row('current'), row('other')]),
      revokeOwn: jest.fn().mockResolvedValue(true),
      revokeOthers: jest.fn().mockResolvedValue(2),
    } as unknown as jest.Mocked<AuthSessionsRepository>;
    service = new AuthSessionsService(repo);
  });

  it('lists each device with its address and marks the current one', async () => {
    const res = await service.list(auth);
    expect(res).toHaveLength(2);
    expect(res.find((s) => s.id === 'current')?.isCurrent).toBe(true);
    expect(res.find((s) => s.id === 'other')?.isCurrent).toBe(false);
    expect(res[0].device).toBe('Chrome on Mac');
  });

  it('signs an unfamiliar device out', async () => {
    await service.revoke(auth, 'other');
    expect(repo.revokeOwn).toHaveBeenCalledWith(1, 'u1', 'other');
  });

  it('refuses to revoke the device I am using', async () => {
    await expect(service.revoke(auth, 'current')).rejects.toBeInstanceOf(
      DomainException,
    );
    expect(repo.revokeOwn).not.toHaveBeenCalled();
  });

  it('404s a session that is already gone', async () => {
    repo.revokeOwn.mockResolvedValue(false);
    await expect(service.revoke(auth, 'stale')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('signs out all other sessions, keeping this one', async () => {
    const res = await service.revokeOthers(auth);
    expect(repo.revokeOthers).toHaveBeenCalledWith(1, 'u1', 'current');
    expect(res).toEqual({ revoked: 2 });
  });
});
