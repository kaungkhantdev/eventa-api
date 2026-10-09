import { contactAuditSubject } from '../attendee-directory/attendee-contact.audit';
import { AUDIT_SUBJECT_TYPES, toSubjectFilter } from './audit-subject';

describe('resolving an audit subject to a filter (US-REG-08 AC5)', () => {
  it('reads the prefix from the writer that records it, not a copy', () => {
    expect(toSubjectFilter({ type: 'attendee', id: 42 })).toEqual({
      auditType: 'attendee',
      metaPrefix: contactAuditSubject(42),
    });
  });

  it('keeps attendee #4 from matching attendee #42', () => {
    const four = toSubjectFilter({ type: 'attendee', id: 4 }).metaPrefix;
    const fortyTwo = toSubjectFilter({ type: 'attendee', id: 42 }).metaPrefix;
    expect(fortyTwo.startsWith(four)).toBe(false);
  });

  it('pins the subject to the audit type its writer uses', () => {
    expect(toSubjectFilter({ type: 'attendee', id: 1 }).auditType).toBe(
      'attendee',
    );
  });

  it('resolves every subject type the DTO accepts', () => {
    for (const type of AUDIT_SUBJECT_TYPES) {
      expect(toSubjectFilter({ type, id: 1 }).metaPrefix).not.toBe('');
    }
  });
});
