import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';
import type { ObjectStoragePort } from '../profile-photo/ports/object-storage.port';
import { ImageUploadService, type UploadScope } from './image-upload.service';

const MAX_BYTES = 5_242_880;

const SCOPE: UploadScope = {
  stagingPrefix: 'uploads/org/7/',
  finalPrefix: 'logos/7/',
  noun: 'workspace logo',
};

/** The first bytes of a real PNG. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** An HTML document, whatever it claims to be. */
const HTML = new Uint8Array([0x3c, 0x21, 0x44, 0x4f, 0x43]);

describe('ImageUploadService', () => {
  let storage: jest.Mocked<ObjectStoragePort>;
  let service: ImageUploadService;

  beforeEach(() => {
    storage = {
      presignPut: jest.fn().mockResolvedValue({
        uploadUrl: 'https://storage.test/put',
        headers: { 'content-type': 'image/png' },
        expiresInSeconds: 300,
      }),
      head: jest
        .fn()
        .mockResolvedValue({ contentType: 'image/png', byteSize: 1024 }),
      readPrefix: jest.fn().mockResolvedValue(PNG),
      copy: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
      publicUrl: jest.fn((key: string) => `https://cdn.test/${key}`),
      keyFromPublicUrl: jest.fn((url: string) =>
        url.startsWith('https://cdn.test/') ? url.slice(17) : null,
      ),
    };
    service = new ImageUploadService(storage, {
      getOrThrow: () => MAX_BYTES,
    } as unknown as ConfigService<Env, true>);
  });

  describe('requesting an upload', () => {
    it('issues a key inside the caller’s own staging prefix', async () => {
      const issued = await service.requestUpload(SCOPE, {
        contentType: 'image/png',
        byteSize: 1024,
      });

      expect(issued.key.startsWith(SCOPE.stagingPrefix)).toBe(true);
      expect(issued.key.endsWith('.png')).toBe(true);
      expect(issued.uploadUrl).toBe('https://storage.test/put');
    });

    it('refuses a type that is not an image we accept', async () => {
      await expect(
        service.requestUpload(SCOPE, {
          contentType: 'application/pdf',
          byteSize: 1024,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(storage.presignPut).not.toHaveBeenCalled();
    });

    it('refuses a size beyond the limit, naming what was being uploaded', async () => {
      await expect(
        service.requestUpload(SCOPE, {
          contentType: 'image/png',
          byteSize: MAX_BYTES + 1,
        }),
      ).rejects.toMatchObject({ message: expect.stringContaining('logo') });
    });
  });

  describe('confirming', () => {
    const key = `${SCOPE.stagingPrefix}abc.png`;

    /**
     * The upload URL stays valid until it expires, so leaving the bytes at the
     * key that was signed would let them be swapped after inspection. The copy
     * target was never presigned.
     */
    it('promotes the checked bytes to a key that was never signed', async () => {
      const url = await service.confirm(SCOPE, key);

      expect(storage.copy).toHaveBeenCalledWith({
        from: key,
        to: `${SCOPE.finalPrefix}abc.png`,
        contentType: 'image/png',
      });
      expect(storage.remove).toHaveBeenCalledWith(key);
      expect(url).toBe(`https://cdn.test/${SCOPE.finalPrefix}abc.png`);
    });

    it('refuses a key outside the caller’s prefix', async () => {
      await expect(
        service.confirm(SCOPE, 'uploads/org/8/someone-elses.png'),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(storage.copy).not.toHaveBeenCalled();
    });

    // A key needing normalisation is not one we issued.
    it('refuses a key that tries to climb out with ..', async () => {
      await expect(
        service.confirm(SCOPE, `${SCOPE.stagingPrefix}../../etc/passwd`),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    /**
     * The stored content type is only ever what the client declared on the PUT,
     * so it is not evidence. The leading bytes are.
     */
    it('refuses a file that is not the image type it claims', async () => {
      storage.readPrefix.mockResolvedValue(HTML);

      await expect(service.confirm(SCOPE, key)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      // and the impostor does not stay in the bucket
      expect(storage.remove).toHaveBeenCalledWith(key);
      expect(storage.copy).not.toHaveBeenCalled();
    });

    it('refuses when nothing was actually uploaded', async () => {
      storage.head.mockResolvedValue(null);

      await expect(service.confirm(SCOPE, key)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('refuses — and deletes — an object larger than the limit', async () => {
      storage.head.mockResolvedValue({
        contentType: 'image/png',
        byteSize: MAX_BYTES + 1,
      });

      await expect(service.confirm(SCOPE, key)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(storage.remove).toHaveBeenCalledWith(key);
      expect(storage.copy).not.toHaveBeenCalled();
    });
  });

  describe('removing', () => {
    it('deletes the object the saved URL points at', async () => {
      await service.removeAt('https://cdn.test/logos/7/abc.png');
      expect(storage.remove).toHaveBeenCalledWith('logos/7/abc.png');
    });

    it('does nothing when there is nothing saved', async () => {
      await service.removeAt(null);
      expect(storage.remove).not.toHaveBeenCalled();
    });

    // A URL we did not issue is not ours to delete behind.
    it('leaves a foreign URL alone', async () => {
      await service.removeAt('https://example.test/someone-elses.png');
      expect(storage.remove).not.toHaveBeenCalled();
    });
  });
});
