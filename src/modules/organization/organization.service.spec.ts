import { DomainException } from '../../common/errors/domain.exception';
import { OrganizationRepository } from './organization.repository';
import { OrganizationService } from './organization.service';
import type { OrganizationRow } from './organization.types';

const orgId = 1;

function orgRow(overrides: Partial<OrganizationRow> = {}): OrganizationRow {
  return {
    id: orgId,
    name: 'Acme Events',
    slug: 'acme',
    logoUrl: null,
    address: '99 Sukhumvit Rd, Bangkok 10110',
    website: 'https://acme.co.th',
    currency: 'THB',
    country: 'TH',
    timezone: 'Asia/Bangkok',
    locale: 'en',
    vatRate: '0.0700',
    taxId: '0105556012345',
    version: 1,
    ...overrides,
  } as OrganizationRow;
}

describe('OrganizationService', () => {
  let repo: jest.Mocked<OrganizationRepository>;
  let service: OrganizationService;

  beforeEach(() => {
    repo = {
      find: jest.fn().mockResolvedValue(orgRow()),
      nameTaken: jest.fn().mockResolvedValue(false),
      update: jest
        .fn()
        .mockImplementation((_id, values: object) =>
          Promise.resolve(orgRow(values as Partial<OrganizationRow>)),
        ),
    } as unknown as jest.Mocked<OrganizationRepository>;
    service = new OrganizationService(repo);
  });

  describe('get', () => {
    it('returns the workspace identity including tax id and VAT rate', async () => {
      const res = await service.get(orgId);
      expect(repo.find).toHaveBeenCalledWith(orgId);
      expect(res).toMatchObject({
        name: 'Acme Events',
        taxId: '0105556012345',
        website: 'https://acme.co.th',
        vatRatePercent: 7,
      });
    });

    it('404s when the workspace is gone', async () => {
      repo.find.mockResolvedValue(null);
      await expect(service.get(orgId)).rejects.toBeInstanceOf(DomainException);
    });
  });

  describe('update', () => {
    it('saves the legal details and returns them', async () => {
      const res = await service.update(orgId, {
        name: 'Acme Events Co., Ltd.',
        address: '1 New Rd, Bangkok',
        taxId: '0105556012345',
      });
      expect(repo.update).toHaveBeenCalledWith(
        orgId,
        expect.objectContaining({ name: 'Acme Events Co., Ltd.' }),
        1,
      );
      expect(res.name).toBe('Acme Events Co., Ltd.');
    });

    it('rejects a tax id that is not 13 digits (nothing saved)', async () => {
      await expect(
        service.update(orgId, { taxId: '12345' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('rejects a non-http website (nothing saved)', async () => {
      await expect(
        service.update(orgId, { website: 'javascript:alert(1)' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('accepts clearing the optional tax id and website', async () => {
      await service.update(orgId, { taxId: null, website: null });
      expect(repo.update).toHaveBeenCalledWith(
        orgId,
        expect.objectContaining({ taxId: null, website: null }),
        1,
      );
    });

    it('ignores undefined fields so a partial save never blanks others', async () => {
      await service.update(orgId, { name: 'Only the name' });
      const [, values] = repo.update.mock.calls[0];
      expect(Object.keys(values)).toEqual(['name']);
    });

    /**
     * Optimistic concurrency, as every other editable resource here does it
     * (categories, discounts, speakers, sessions, events, meetings). Two admins
     * on the same workspace settings is the ordinary case, not the exotic one:
     * without this the second save silently overwrites the first.
     */
    describe('version', () => {
      it('refuses a form opened before somebody else’s edit', async () => {
        await expect(
          service.update(orgId, { name: 'Renamed', version: 0 }),
        ).rejects.toMatchObject({ code: 'CONFLICT' });
        expect(repo.update).not.toHaveBeenCalled();
      });

      it('passes the version it read through to the write', async () => {
        await service.update(orgId, { name: 'Renamed', version: 1 });
        expect(repo.update).toHaveBeenCalledWith(
          orgId,
          expect.objectContaining({ name: 'Renamed' }),
          1,
        );
      });

      // The row moved between the read and the write — the guarded UPDATE
      // matches nothing, and that is the same fact as a stale form.
      it('refuses when the guarded write matches no row', async () => {
        repo.update.mockResolvedValueOnce(null);
        await expect(
          service.update(orgId, { name: 'Renamed', version: 1 }),
        ).rejects.toMatchObject({ code: 'CONFLICT' });
      });

      // Older clients, and the API's own tests, send no version at all.
      it('saves without one rather than inventing a conflict', async () => {
        await expect(
          service.update(orgId, { name: 'Renamed' }),
        ).resolves.toBeDefined();
      });

      it('never writes the version as if it were a column of its own', async () => {
        await service.update(orgId, { name: 'Renamed', version: 1 });
        const [, values] = repo.update.mock.calls[0];
        expect(Object.keys(values)).toEqual(['name']);
      });
    });

    /**
     * Renaming into somebody else's name is refused for the same reason
     * sign-up refuses it: the name is what an attendee reads on a ticket, an
     * invoice and a receipt, and two of them make all three ambiguous.
     */
    describe('name', () => {
      it('refuses a name another workspace already has', async () => {
        repo.nameTaken.mockResolvedValue(true);

        await expect(
          service.update(orgId, { name: 'Someone Else Ltd.' }),
        ).rejects.toMatchObject({ code: 'CONFLICT' });
        expect(repo.update).not.toHaveBeenCalled();
      });

      // Or saving the form unchanged would refuse the name it already holds.
      it('does not count the workspace against itself', async () => {
        await service.update(orgId, { name: 'Acme Events' });

        expect(repo.nameTaken).toHaveBeenCalledWith('Acme Events', orgId);
      });

      it('asks nothing when the name is not being changed', async () => {
        await service.update(orgId, { address: 'Somewhere else' });

        expect(repo.nameTaken).not.toHaveBeenCalled();
      });
    });
  });
});
