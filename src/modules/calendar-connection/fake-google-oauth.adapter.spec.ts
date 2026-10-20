import { FakeGoogleOAuthAdapter } from './fake-google-oauth.adapter';
import { OffGoogleOAuthAdapter } from './off-google-oauth.adapter';
import { GoogleOAuthError, GoogleOAuthPort } from './ports/google-oauth.port';
import {
  CALENDAR_SCOPES,
  FAKE_AUTH_CODE,
} from '../../common/constants/calendar-connection.constants';

const REDIRECT =
  'http://localhost:3190/api/v1/public/calendar-connection/google/callback';

describe('FakeGoogleOAuthAdapter (US-MTG-08)', () => {
  const fake: GoogleOAuthPort = new FakeGoogleOAuthAdapter(REDIRECT);

  it('is configured', () => {
    expect(fake.configured).toBe(true);
  });

  it('sends the browser straight back to the callback with its code and the state', () => {
    const url = new URL(fake.authorizeUrl('42.n0nce/+', 'ignored'));
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT);
    expect(url.searchParams.get('code')).toBe(FAKE_AUTH_CODE);
    expect(url.searchParams.get('state')).toBe('42.n0nce/+');
  });

  it('grants a fresh fake refresh token for its own code and a verifier', async () => {
    const first = await fake.exchangeCode(FAKE_AUTH_CODE, 'verifier');
    const second = await fake.exchangeCode(FAKE_AUTH_CODE, 'verifier');
    expect(first.refreshToken).toMatch(/^fake-refresh-[0-9a-f-]{36}$/);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(first.accountEmail).toBe('calendar@example.test');
    expect(first.grantedScopes).toEqual([...CALENDAR_SCOPES]);
  });

  it('refuses an exchange without a verifier, as PKCE would', async () => {
    await expect(fake.exchangeCode(FAKE_AUTH_CODE, '')).rejects.toBeInstanceOf(
      GoogleOAuthError,
    );
  });

  it('refuses any other code', async () => {
    await expect(
      fake.exchangeCode('stolen-code', 'verifier'),
    ).rejects.toBeInstanceOf(GoogleOAuthError);
  });

  it('revokes without complaint', async () => {
    await expect(fake.revoke('fake-refresh-x')).resolves.toBeUndefined();
  });
});

describe('OffGoogleOAuthAdapter (US-MTG-08)', () => {
  const off: GoogleOAuthPort = new OffGoogleOAuthAdapter();

  it('is not configured', () => {
    expect(off.configured).toBe(false);
  });

  it('refuses every call', async () => {
    expect(() => off.authorizeUrl('s', 'c')).toThrow();
    await expect(off.exchangeCode('c', 'v')).rejects.toThrow();
    await expect(off.revoke('t')).rejects.toThrow();
  });
});
