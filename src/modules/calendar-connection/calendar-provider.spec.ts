import {
  CALENDAR_CALLBACK_PATH,
  CALENDAR_EVENTS_SCOPE,
  CALENDAR_SCOPES,
  MANAGE_INTEGRATIONS,
  resolveCalendarProvider,
} from './calendar-provider';

describe('resolveCalendarProvider (US-MTG-08)', () => {
  const both = {
    GOOGLE_CALENDAR_CLIENT_ID: 'id',
    GOOGLE_CALENDAR_CLIENT_SECRET: 'secret',
  };

  it.each(['off', 'fake', 'google'] as const)(
    'lets an explicit %s win over the credentials',
    (provider) => {
      expect(
        resolveCalendarProvider({ ...both, CALENDAR_PROVIDER: provider }),
      ).toBe(provider);
    },
  );

  it('chooses google when unset and both client values are present', () => {
    expect(resolveCalendarProvider(both)).toBe('google');
  });

  it('chooses off when unset and the secret is missing', () => {
    expect(resolveCalendarProvider({ GOOGLE_CALENDAR_CLIENT_ID: 'id' })).toBe(
      'off',
    );
  });

  it('chooses off when unset and the id is missing', () => {
    expect(
      resolveCalendarProvider({ GOOGLE_CALENDAR_CLIENT_SECRET: 'secret' }),
    ).toBe('off');
  });

  it('chooses off when nothing is configured', () => {
    expect(resolveCalendarProvider({})).toBe('off');
  });
});

describe('calendar constants', () => {
  it('asks Google for events only, plus who granted it', () => {
    expect(CALENDAR_EVENTS_SCOPE).toBe(
      'https://www.googleapis.com/auth/calendar.events',
    );
    expect(CALENDAR_SCOPES).toEqual(['openid', 'email', CALENDAR_EVENTS_SCOPE]);
  });

  it('names the callback under the global /api/v1 prefix', () => {
    expect(CALENDAR_CALLBACK_PATH).toBe(
      '/api/v1/public/calendar-connection/google/callback',
    );
  });

  it('gates connecting on Manage integrations', () => {
    expect(MANAGE_INTEGRATIONS).toBe('setIntegrations');
  });
});
