import type { SecretCipher } from '../../common/crypto/secret-cipher';
import { DomainException } from '../../common/errors/domain.exception';
import type { Clock } from '../../common/time/clock';
import type { PaymentCredentialsRepository } from './payment-credentials.repository';
import { PaymentKeysService } from './payment-keys.service';
import type { PaymentSettingsRepository } from './payment-settings.repository';
import type {
  PaymentCredentialsRow,
  PaymentSettingsRow,
} from './payment-settings.types';
import type { PaymentProviderPort } from './ports/payment-provider.port';

const ORG = 7;
const NOW = new Date('2026-08-21T10:00:00Z');
const TEST_PK = 'pk_test_51P9xEventa0aB3kY7cQ';
const TEST_SK = 'sk_test_51P9xEventa7hV6tL1pX';
const LIVE_PK = 'pk_live_51P9xEventa0aB3kY7cQ';
const LIVE_SK = 'sk_live_51P9xEventa7hV6tL1pX';
const WHSEC = 'whsec_51P9xEventaSigningSecret';
const ACCOUNT = 'acct_1A2b3C';

/**
 * A stand-in cipher: reversible, and — the part that matters for these tests —
 * its output does not contain its input, so "the plaintext never reached the
 * repository" is a claim the assertions can actually check. The real one is
 * AES-256-GCM; this only has to stand in for the *call*.
 */
const cipher = {
  encrypt: (plain: string) => Buffer.from(plain, 'utf8').toString('base64'),
  decrypt: (payload: Buffer) =>
    Buffer.from(payload.toString('utf8'), 'base64').toString('utf8'),
} as unknown as SecretCipher;

/** What the double produces, for building rows that look already-stored. */
const sealed = (plain: string) =>
  Buffer.from(Buffer.from(plain, 'utf8').toString('base64'));

const settingsRow = (o: Partial<PaymentSettingsRow> = {}): PaymentSettingsRow =>
  ({
    id: 1,
    organizationId: ORG,
    provider: 'stripe',
    mode: 'test',
    status: 'disconnected',
    accountId: null,
    publishableKey: null,
    webhookToken: null,
    ...o,
  }) as PaymentSettingsRow;

const credentialsRow = (
  o: Partial<PaymentCredentialsRow> = {},
): PaymentCredentialsRow =>
  ({
    id: 1,
    organizationId: ORG,
    mode: 'test',
    publishableKey: TEST_PK,
    secretKeyCipher: sealed(TEST_SK),
    webhookSecretCipher: sealed(WHSEC),
    savedAt: NOW,
    ...o,
  }) as PaymentCredentialsRow;

describe('PaymentKeysService (US-SET-08)', () => {
  let credentials: jest.Mocked<PaymentCredentialsRepository>;
  let settings: jest.Mocked<PaymentSettingsRepository>;
  let provider: jest.Mocked<PaymentProviderPort>;
  let service: PaymentKeysService;

  beforeEach(() => {
    credentials = {
      find: jest.fn().mockResolvedValue(credentialsRow()),
      save: jest.fn().mockResolvedValue(credentialsRow()),
      deleteAll: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PaymentCredentialsRepository>;
    settings = {
      findOrCreate: jest.fn().mockResolvedValue(settingsRow()),
      update: jest
        .fn()
        .mockImplementation((_o, values: Partial<PaymentSettingsRow>) =>
          Promise.resolve(settingsRow(values)),
        ),
    } as unknown as jest.Mocked<PaymentSettingsRepository>;
    provider = {
      verifyKey: jest.fn().mockResolvedValue({ ok: true, accountId: ACCOUNT }),
    };
    const clock: Clock = { now: () => NOW };
    service = new PaymentKeysService(credentials, settings, provider, cipher, clock);
  });

  const save = (o: Record<string, unknown> = {}) =>
    service.saveKeys(ORG, {
      mode: 'test',
      publishableKey: TEST_PK,
      secretKey: TEST_SK,
      ...o,
    } as never);

  describe('saveKeys', () => {
    it('proves the key works before storing it', async () => {
      await save();
      expect(provider.verifyKey).toHaveBeenCalledWith(TEST_SK);
    });

    /**
     * Storing first and verifying later would leave a workspace marked ready on
     * a key that never worked — and the discovery would be a buyer's failed
     * checkout.
     */
    it('stores nothing when Stripe rejects the key', async () => {
      provider.verifyKey.mockResolvedValue({
        ok: false,
        reason: 'Invalid API Key provided',
      });
      await expect(save()).rejects.toBeInstanceOf(DomainException);
      expect(credentials.save).not.toHaveBeenCalled();
      expect(settings.update).not.toHaveBeenCalled();
    });

    it('blames the secret key field, so the reason lands under that box', async () => {
      provider.verifyKey.mockResolvedValue({ ok: false, reason: 'Key revoked' });
      const failure = await save().catch((e: DomainException) => e);
      const [refused] = (failure as DomainException).errors ?? [];
      expect(refused?.field).toBe('secretKey');
      expect(refused?.message).toContain('Key revoked');
    });

    /** The mode rules live in `stripe-keys`; this proves they are applied. */
    it('refuses live keys saved under test mode, without calling Stripe', async () => {
      await expect(
        save({ publishableKey: LIVE_PK, secretKey: LIVE_SK }),
      ).rejects.toBeInstanceOf(DomainException);
      expect(provider.verifyKey).not.toHaveBeenCalled();
    });

    it('encrypts the secret key — the plaintext never reaches the repository', async () => {
      await save();
      const [, , input] = credentials.save.mock.calls[0];
      expect(input.secretKeyCipher.toString('utf8')).not.toContain(TEST_SK);
      expect(cipher.decrypt(input.secretKeyCipher)).toBe(TEST_SK);
    });

    it('encrypts the webhook signing secret too', async () => {
      await save({ webhookSecret: WHSEC });
      const [, , input] = credentials.save.mock.calls[0];
      expect(cipher.decrypt(input.webhookSecretCipher as Buffer)).toBe(WHSEC);
    });

    /**
     * Re-pasting API keys is not a statement about the signing secret, which
     * lives on a different Stripe page. Blanking it would silently stop every
     * order settling.
     */
    it('leaves the stored webhook secret alone when none is submitted', async () => {
      await save();
      const [, , input] = credentials.save.mock.calls[0];
      expect(input.webhookSecretCipher).toBeUndefined();
    });

    it('keeps each mode’s pair separate', async () => {
      await save({
        mode: 'live',
        publishableKey: LIVE_PK,
        secretKey: LIVE_SK,
      });
      const [, mode] = credentials.save.mock.calls[0];
      expect(mode).toBe('live');
    });

    it('records the account the key turned out to belong to', async () => {
      await save();
      expect(settings.update).toHaveBeenCalledWith(
        ORG,
        expect.objectContaining({ status: 'connected', accountId: ACCOUNT }),
      );
    });

    /**
     * The webhook URL has to exist before the organizer can register it with
     * Stripe, and it must not change under them afterwards — a rotated token
     * would silently orphan the endpoint they already created.
     */
    it('mints a webhook token on first save', async () => {
      await save();
      const [, values] = settings.update.mock.calls[0];
      expect(values.webhookToken).toEqual(expect.any(String));
      expect((values.webhookToken as string).length).toBeGreaterThanOrEqual(24);
    });

    it('keeps the existing webhook token on a later save', async () => {
      settings.findOrCreate.mockResolvedValue(
        settingsRow({ webhookToken: 'tok_already_registered' }),
      );
      await save();
      const [, values] = settings.update.mock.calls[0];
      expect(values.webhookToken).toBeUndefined();
    });
  });

  /**
   * Everything the page may know about stored keys. The secret is never among
   * it — only enough to answer "which key is saved".
   */
  describe('describe — what the screen is allowed to see', () => {
    it('shows the publishable key and a masked tail of the secret', async () => {
      const view = await service.describe(ORG, 'test');
      expect(view.publishableKey).toBe(TEST_PK);
      expect(view.secretKeyMasked).toBe('••••L1pX');
      expect(view.savedAt).toEqual(NOW);
    });

    it('never returns the secret key, at any depth', async () => {
      const view = await service.describe(ORG, 'test');
      expect(JSON.stringify(view)).not.toContain(TEST_SK);
      expect(JSON.stringify(view)).not.toContain(sealed(TEST_SK).toString('utf8'));
    });

    it('never returns the webhook signing secret', async () => {
      const view = await service.describe(ORG, 'test');
      expect(JSON.stringify(view)).not.toContain(WHSEC);
    });

    it('says a webhook secret is set without revealing it', async () => {
      expect((await service.describe(ORG, 'test')).webhookSecretSet).toBe(true);
    });

    it('reports an empty mode as empty rather than inventing a row', async () => {
      credentials.find.mockResolvedValue(null);
      const view = await service.describe(ORG, 'live');
      expect(view.publishableKey).toBe('');
      expect(view.secretKeyMasked).toBe('');
      expect(view.savedAt).toBeNull();
      expect(view.webhookSecretSet).toBe(false);
    });
  });

  describe('disconnect', () => {
    /**
     * "Stop using my Stripe" has to mean the secrets go. Keeping a credential
     * after being told to stop holding it is the whole problem with storing one.
     */
    it('forgets both modes’ keys, not just the active one', async () => {
      await service.disconnect(ORG);
      expect(credentials.deleteAll).toHaveBeenCalledWith(ORG);
    });

    it('marks the workspace disconnected and stamps when', async () => {
      await service.disconnect(ORG);
      expect(settings.update).toHaveBeenCalledWith(
        ORG,
        expect.objectContaining({
          status: 'disconnected',
          accountId: null,
          publishableKey: null,
          disconnectedAt: NOW,
        }),
      );
    });
  });

  describe('testConnection', () => {
    it('checks the stored key for the active mode, without moving money', async () => {
      const result = await service.testConnection(ORG);
      expect(provider.verifyKey).toHaveBeenCalledWith(TEST_SK);
      expect(result.ok).toBe(true);
    });

    it('refuses when this mode has no keys saved', async () => {
      credentials.find.mockResolvedValue(null);
      await expect(service.testConnection(ORG)).rejects.toBeInstanceOf(
        DomainException,
      );
    });

    it('passes Stripe’s reason through when the key stopped working', async () => {
      provider.verifyKey.mockResolvedValue({ ok: false, reason: 'Key revoked' });
      expect(await service.testConnection(ORG)).toMatchObject({
        ok: false,
        reason: 'Key revoked',
      });
    });
  });
});
