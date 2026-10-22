import { toCalendarConnectionDto } from './calendar-connection.mapper';
import type { CalendarConnectionRow } from './calendar-connection.types';

const CONNECTED_AT = new Date('2026-10-20T03:00:00Z');

const row = (
  o: Partial<CalendarConnectionRow> = {},
): CalendarConnectionRow => ({
  id: 1,
  organizationId: 7,
  status: 'connected',
  accountEmail: 'events@acme.co.th',
  refreshTokenCipher: Buffer.from('cipher-bytes'),
  connectedBy: '00000000-0000-4000-8000-000000000001',
  connectedAt: CONNECTED_AT,
  disconnectedAt: null,
  oauthStateHash: 'a'.repeat(64),
  oauthStateUserId: '00000000-0000-4000-8000-000000000002',
  oauthVerifierCipher: Buffer.from('verifier-bytes'),
  oauthStateExpiresAt: new Date('2026-10-20T03:10:00Z'),
  createdAt: CONNECTED_AT,
  updatedAt: CONNECTED_AT,
  ...o,
});

describe('toCalendarConnectionDto (US-MTG-08)', () => {
  it('shows a connected workspace, with the account to an Admin', () => {
    expect(toCalendarConnectionDto(row(), true, true)).toEqual({
      provider: 'google',
      status: 'connected',
      accountEmail: 'events@acme.co.th',
      connectedAt: '2026-10-20T03:00:00.000Z',
    });
  });

  it('withholds the account from a member without Manage integrations', () => {
    expect(toCalendarConnectionDto(row(), true, false)).toMatchObject({
      status: 'connected',
      accountEmail: null,
      connectedAt: '2026-10-20T03:00:00.000Z',
    });
  });

  it('keeps the facts of an expired connection, so the Admin knows what to reconnect', () => {
    expect(
      toCalendarConnectionDto(row({ status: 'expired' }), true, true),
    ).toMatchObject({
      status: 'expired',
      accountEmail: 'events@acme.co.th',
      connectedAt: '2026-10-20T03:00:00.000Z',
    });
  });

  it('reads no row as disconnected', () => {
    expect(toCalendarConnectionDto(null, true, true)).toEqual({
      provider: 'google',
      status: 'disconnected',
      accountEmail: null,
      connectedAt: null,
    });
  });

  it('shows no facts for a disconnected row, even if some linger', () => {
    expect(
      toCalendarConnectionDto(row({ status: 'disconnected' }), true, true),
    ).toMatchObject({ accountEmail: null, connectedAt: null });
  });

  it('says not_configured whatever the row says when the server has no Google client', () => {
    expect(toCalendarConnectionDto(row(), false, true)).toEqual({
      provider: 'google',
      status: 'not_configured',
      accountEmail: null,
      connectedAt: null,
    });
  });

  it('never carries a cipher, the pending state, its user or who connected', () => {
    const dto = toCalendarConnectionDto(row(), true, true);
    expect(Object.keys(dto).sort()).toEqual([
      'accountEmail',
      'connectedAt',
      'provider',
      'status',
    ]);
    const text = JSON.stringify(dto);
    expect(text).not.toContain('cipher');
    expect(text).not.toContain('a'.repeat(64));
    expect(text).not.toContain('00000000-0000-4000-8000-00000000000');
  });
});
