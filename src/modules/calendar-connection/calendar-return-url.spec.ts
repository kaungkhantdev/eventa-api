import { settingsReturnUrl } from './calendar-return-url';

describe('settingsReturnUrl (US-MTG-08)', () => {
  it.each(['connected', 'denied', 'failed'] as const)(
    'lands %s on Settings → Integrations',
    (outcome) => {
      expect(settingsReturnUrl('https://app.eventa.co.th', outcome)).toBe(
        `https://app.eventa.co.th/admin/settings-integrations?calendar=${outcome}`,
      );
    },
  );

  it('never doubles a slash when the base ends in one', () => {
    expect(settingsReturnUrl('http://localhost:5173//', 'connected')).toBe(
      'http://localhost:5173/admin/settings-integrations?calendar=connected',
    );
  });

  it('refuses any outcome outside the three, rather than echoing it', () => {
    expect(() =>
      settingsReturnUrl(
        'http://localhost:5173',
        'https://evil.example' as never,
      ),
    ).toThrow();
  });
});
