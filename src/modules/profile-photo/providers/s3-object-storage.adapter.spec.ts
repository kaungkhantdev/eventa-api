import type { S3Client } from '@aws-sdk/client-s3';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.validation';
import { S3ObjectStorageAdapter } from './s3-object-storage.adapter';

const BUCKET = 'eventa-uploads';
const REGION = 'ap-southeast-1';
const TTL = 300;
const KEY = 'avatars/u-1/photo.jpg';

type Settings = Partial<Record<string, string | number>>;

/** Real credentials are needed for a real signature; these are throwaway. */
function config(overrides: Settings = {}): ConfigService<Env, true> {
  const values: Settings = {
    S3_BUCKET: BUCKET,
    S3_REGION: REGION,
    UPLOAD_URL_TTL_SECONDS: TTL,
    S3_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
    S3_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService<Env, true>;
}

function fakeClient(send: jest.Mock): S3Client {
  return { send } as unknown as S3Client;
}

describe('S3ObjectStorageAdapter (US-DISC-11)', () => {
  describe('presignPut — a real signature over a real URL', () => {
    const presign = async (overrides: Settings = {}) => {
      const adapter = new S3ObjectStorageAdapter(config(overrides));
      const result = await adapter.presignPut({
        key: KEY,
        contentType: 'image/jpeg',
        byteSize: 20_480,
      });
      return { result, url: new URL(result.uploadUrl) };
    };

    it('signs the content type, so the client cannot upload something else', async () => {
      const { url } = await presign();
      const signedHeaders = url.searchParams.get('X-Amz-SignedHeaders') ?? '';
      // The SDK marks content-type unsignable by DEFAULT; without the explicit
      // signableHeaders override, a URL signed for a JPEG accepts text/html.
      expect(signedHeaders).toContain('content-type');
    });

    it('signs the exact byte length', async () => {
      const { url } = await presign();
      expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain(
        'content-length',
      );
    });

    it('does not hoist a checksum of the empty body into the URL', async () => {
      const { url } = await presign();
      // At the SDK default (WHEN_SUPPORTED) a CRC32 of the ABSENT body is signed
      // into the query, and every real upload then fails S3's checksum check.
      const checksums = [...url.searchParams.keys()].filter((k) =>
        k.toLowerCase().startsWith('x-amz-checksum'),
      );
      expect(checksums).toEqual([]);
    });

    it('expires the capability on the configured window', async () => {
      const { result, url } = await presign();
      expect(url.searchParams.get('X-Amz-Expires')).toBe(String(TTL));
      expect(result.expiresInSeconds).toBe(TTL);
    });

    it('tells the client exactly which headers the PUT must carry', async () => {
      const { result } = await presign();
      expect(result.headers).toEqual({
        'content-type': 'image/jpeg',
        'content-length': '20480',
      });
    });

    it('addresses an S3-compatible endpoint path-style, for local MinIO', async () => {
      const { url } = await presign({ S3_ENDPOINT: 'http://localhost:9000' });
      expect(url.host).toBe('localhost:9000');
      expect(url.pathname).toBe(`/${BUCKET}/${KEY}`);
    });
  });

  describe('head', () => {
    it('reports what actually landed', async () => {
      const send = jest
        .fn()
        .mockResolvedValue({ ContentType: 'image/png', ContentLength: 1024 });
      const adapter = new S3ObjectStorageAdapter(config(), fakeClient(send));
      await expect(adapter.head(KEY)).resolves.toEqual({
        contentType: 'image/png',
        byteSize: 1024,
      });
    });

    it('answers null when nothing was uploaded', async () => {
      const missing = Object.assign(new Error('nope'), { name: 'NotFound' });
      const adapter = new S3ObjectStorageAdapter(
        config(),
        fakeClient(jest.fn().mockRejectedValue(missing)),
      );
      await expect(adapter.head(KEY)).resolves.toBeNull();
    });

    it('answers null on a bare 404 with no error name', async () => {
      const missing = { $metadata: { httpStatusCode: 404 } };
      const adapter = new S3ObjectStorageAdapter(
        config(),
        fakeClient(jest.fn().mockRejectedValue(missing)),
      );
      await expect(adapter.head(KEY)).resolves.toBeNull();
    });

    it('does NOT swallow a real failure as "not uploaded"', async () => {
      const denied = Object.assign(new Error('denied'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      });
      const adapter = new S3ObjectStorageAdapter(
        config(),
        fakeClient(jest.fn().mockRejectedValue(denied)),
      );
      // Treating this as null would let a misconfigured bucket read as
      // "the upload never happened" — a confusing 422 instead of a real error.
      await expect(adapter.head(KEY)).rejects.toThrow('denied');
    });
  });

  describe('remove', () => {
    it('never fails the caller — a leftover object is cheaper than a failed request', async () => {
      const adapter = new S3ObjectStorageAdapter(
        config(),
        fakeClient(jest.fn().mockRejectedValue(new Error('network'))),
      );
      await expect(adapter.remove(KEY)).resolves.toBeUndefined();
    });
  });

  describe('copy — how a checked upload is made immutable', () => {
    it('rewrites the metadata, so no client-supplied header survives', async () => {
      const send = jest.fn().mockResolvedValue({});
      const adapter = new S3ObjectStorageAdapter(config(), fakeClient(send));
      await adapter.copy({
        from: 'uploads/u-1/a.jpg',
        to: 'avatars/u-1/a.jpg',
        contentType: 'image/jpeg',
      });
      const [command] = send.mock.calls[0] as [
        { input: Record<string, unknown> },
      ];
      const { input } = command;
      expect(input.CopySource).toBe(`${BUCKET}/uploads/u-1/a.jpg`);
      expect(input.Key).toBe('avatars/u-1/a.jpg');
      // Without REPLACE the source's Content-Disposition/Encoding come along.
      expect(input.MetadataDirective).toBe('REPLACE');
      expect(input.ContentType).toBe('image/jpeg');
      expect(input.ContentDisposition).toBe('inline');
    });
  });

  describe('readPrefix', () => {
    it('asks for only the leading bytes', async () => {
      const send = jest.fn().mockResolvedValue({
        Body: {
          transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2])),
        },
      });
      const adapter = new S3ObjectStorageAdapter(config(), fakeClient(send));
      const bytes = await adapter.readPrefix(KEY, 12);
      const [command] = send.mock.calls[0] as [
        { input: Record<string, unknown> },
      ];
      const { input } = command;
      expect(input.Range).toBe('bytes=0-11');
      expect(bytes).toEqual(new Uint8Array([1, 2]));
    });

    it('answers null when the object is not there', async () => {
      const missing = Object.assign(new Error('nope'), { name: 'NotFound' });
      const adapter = new S3ObjectStorageAdapter(
        config(),
        fakeClient(jest.fn().mockRejectedValue(missing)),
      );
      await expect(adapter.readPrefix(KEY, 12)).resolves.toBeNull();
    });
  });

  describe('publicUrl', () => {
    it('serves from the CDN when one is configured', () => {
      const adapter = new S3ObjectStorageAdapter(
        config({ S3_PUBLIC_BASE_URL: 'https://cdn.eventa.co.th' }),
        fakeClient(jest.fn()),
      );
      expect(adapter.publicUrl(KEY)).toBe(`https://cdn.eventa.co.th/${KEY}`);
    });

    it('falls back to the bucket’s own origin', () => {
      const adapter = new S3ObjectStorageAdapter(
        config(),
        fakeClient(jest.fn()),
      );
      expect(adapter.publicUrl(KEY)).toBe(
        `https://${BUCKET}.s3.${REGION}.amazonaws.com/${KEY}`,
      );
    });

    it('serves from an S3-compatible endpoint rather than a dead AWS hostname', () => {
      // MinIO: the bytes are presigned to localhost, so an amazonaws.com URL
      // saved onto the profile would be a broken image forever.
      const adapter = new S3ObjectStorageAdapter(
        config({ S3_ENDPOINT: 'http://localhost:9000' }),
        fakeClient(jest.fn()),
      );
      expect(adapter.publicUrl(KEY)).toBe(
        `http://localhost:9000/${BUCKET}/${KEY}`,
      );
    });

    it('round-trips a URL back to its key, and refuses a foreign one', () => {
      const adapter = new S3ObjectStorageAdapter(
        config({ S3_PUBLIC_BASE_URL: 'https://cdn.eventa.co.th' }),
        fakeClient(jest.fn()),
      );
      expect(adapter.keyFromPublicUrl(adapter.publicUrl(KEY))).toBe(KEY);
      expect(adapter.keyFromPublicUrl('https://evil.test/x.jpg')).toBeNull();
    });
  });
});
