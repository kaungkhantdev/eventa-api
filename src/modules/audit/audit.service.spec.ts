import type { PermissionsService } from '../access/permissions.service';
import { AuditRepository, type AuditRecord } from './audit.repository';
import { AuditService } from './audit.service';
import { maskSecrets } from './dto/audit-entry.dto';

const auth = { organizationId: 1, userId: 'u1', sessionId: 's1' };

function record(over: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: 1,
    type: 'perm',
    title: 'Changed role from Staff to Organizer',
    meta: null,
    actorUserId: 'admin-1',
    actorName: 'Admin',
    ipAddress: '203.0.113.9',
    occurredAt: new Date('2026-07-31T00:00:00Z'),
    ...over,
  };
}

describe('AuditService (US-SET-05)', () => {
  let repo: jest.Mocked<AuditRepository>;
  let permissions: jest.Mocked<PermissionsService>;
  let service: AuditService;

  const asAdmin = (yes: boolean) =>
    permissions.getFor.mockResolvedValue(yes ? ['setUsers'] : ['regView']);

  beforeEach(() => {
    repo = {
      page: jest.fn().mockResolvedValue({ items: [record()], total: 1 }),
      all: jest.fn().mockResolvedValue([record()]),
      recordExport: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditRepository>;
    permissions = {
      getFor: jest.fn(),
    } as unknown as jest.Mocked<PermissionsService>;
    asAdmin(true);
    service = new AuditService(repo, permissions);
  });

  it('shows a role change with who changed it and when', async () => {
    const res = await service.list(auth, {});
    expect(res.items[0]).toMatchObject({
      title: 'Changed role from Staff to Organizer',
      actorName: 'Admin',
      occurredAt: '2026-07-31T00:00:00.000Z',
    });
  });

  it('an Admin sees the whole workspace', async () => {
    await service.list(auth, {});
    const [, query] = repo.page.mock.calls[0];
    expect(query.actorUserId).toBeUndefined();
  });

  it('a non-Admin is pinned to their own events', async () => {
    asAdmin(false);
    await service.list(auth, {});
    const [, query] = repo.page.mock.calls[0];
    expect(query.actorUserId).toBe('u1');
  });

  it('exports a date range and records the export as a new entry', async () => {
    const res = await service.export(auth, {
      from: '2026-07-01',
      to: '2026-07-31',
    });
    expect(res.filename).toBe('audit-2026-07-01-to-2026-07-31.csv');
    expect(res.csv.split('\n')[0]).toBe(
      'occurredAt,type,title,actor,ipAddress',
    );
    expect(repo.recordExport).toHaveBeenCalledWith(
      1,
      'u1',
      expect.stringContaining('Exported 1 audit entries'),
    );
  });

  it('escapes a title containing a comma so columns stay aligned', async () => {
    repo.all.mockResolvedValue([record({ title: 'Removed Ann, the Admin' })]);
    const res = await service.export(auth, {});
    expect(res.csv).toContain('"Removed Ann, the Admin"');
  });

  it('masks anything secret-looking to a hint', () => {
    expect(maskSecrets('rotated key sk_live_ABCDEFGHIJ1234')).toBe(
      'rotated key ••••1234',
    );
  });

  it('exposes no way to edit or delete an entry', () => {
    const surface = Object.getOwnPropertyNames(AuditRepository.prototype);
    expect(surface).not.toContain('update');
    expect(surface).not.toContain('delete');
  });
});
