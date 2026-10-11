import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { auditTypeEnum } from '../../../db/schema';
import { AUDIT_SUBJECT_TYPES } from '../audit-subject';
import { ListAuditQueryDto } from './list-audit.query.dto';

const refused = (query: Record<string, unknown>): string[] =>
  validateSync(plainToInstance(ListAuditQueryDto, query)).map(
    (e) => e.property,
  );

const dto = (query: Record<string, unknown>): ListAuditQueryDto =>
  plainToInstance(ListAuditQueryDto, query);

describe('ListAuditQueryDto', () => {
  it('still accepts the plain page+range query the settings log sends', () => {
    expect(refused({ page: '2', limit: '50', from: '2026-07-01' })).toEqual([]);
  });

  describe('the subject pair (US-REG-08 AC5)', () => {
    it('accepts a whole subject and coerces the id from the query string', () => {
      expect(refused({ subjectType: 'attendee', subjectId: '42' })).toEqual([]);
      expect(dto({ subjectType: 'attendee', subjectId: '42' }).subjectId).toBe(
        42,
      );
    });

    it('refuses an id with no kind rather than listing the workspace', () => {
      expect(refused({ subjectId: '42' })).toContain('subjectType');
    });

    it('refuses a kind with no id', () => {
      expect(refused({ subjectType: 'attendee' })).toContain('subjectId');
    });

    it('refuses a record kind nothing writes a subject for', () => {
      expect(refused({ subjectType: 'payout', subjectId: '1' })).toContain(
        'subjectType',
      );
    });

    it('refuses an id that is not a positive integer', () => {
      expect(refused({ subjectType: 'attendee', subjectId: '0' })).toContain(
        'subjectId',
      );
      expect(
        refused({ subjectType: 'attendee', subjectId: 'attendee' }),
      ).toContain('subjectId');
    });

    it('offers only kinds a resolver exists for', () => {
      expect([...AUDIT_SUBJECT_TYPES]).toEqual(['attendee']);
    });
  });

  describe('the type filter', () => {
    it('accepts every label the schema enum defines', () => {
      for (const type of auditTypeEnum.enumValues) {
        expect(refused({ type })).toEqual([]);
      }
    });

    it('refuses a label that is not one of them', () => {
      expect(refused({ type: 'attendees' })).toContain('type');
    });
  });
});
