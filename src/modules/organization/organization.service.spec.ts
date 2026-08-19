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
      );
    });

    it('ignores undefined fields so a partial save never blanks others', async () => {
      await service.update(orgId, { name: 'Only the name' });
      const [, values] = repo.update.mock.calls[0];
      expect(Object.keys(values)).toEqual(['name']);
    });
  });
});
