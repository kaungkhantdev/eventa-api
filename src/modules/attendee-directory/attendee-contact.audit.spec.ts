import {
  CONTACT_AUDIT_TITLE,
  CONTACT_AUDIT_TYPE,
  contactAuditMeta,
  contactAuditSubject,
} from './attendee-contact.audit';

describe('the contact-edit audit entry (US-REG-08 AC1 + AC5)', () => {
  it('uses the story’s own phrase as the title, unparameterised', () => {
    expect(CONTACT_AUDIT_TITLE).toBe('Updated contact details');
  });

  it('is typed as an attendee act, not borrowed from another family', () => {
    expect(CONTACT_AUDIT_TYPE).toBe('attendee');
  });

  it('names the record and the fields that moved', () => {
    expect(contactAuditMeta(42, ['email', 'phone'])).toBe(
      'attendee #42 · changed: email, phone',
    );
  });

  it('never writes the values — audit_events cannot be erased on request', () => {
    const meta = contactAuditMeta(42, ['name', 'email', 'phone']);
    expect(meta).not.toMatch(/@/);
    expect(meta).toBe('attendee #42 · changed: name, email, phone');
  });

  it('begins with the subject a per-attendee timeline will filter on', () => {
    expect(contactAuditSubject(42)).toBe('attendee #42 ·');
    expect(
      contactAuditMeta(42, ['name']).startsWith(contactAuditSubject(42)),
    ).toBe(true);
  });

  it('keeps attendee #4’s prefix from matching attendee #42’s entry', () => {
    expect(
      contactAuditMeta(42, ['name']).startsWith(contactAuditSubject(4)),
    ).toBe(false);
  });
});
