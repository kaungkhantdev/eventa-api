import type { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain.exception';
import type { AuthContext } from '../auth/auth.types';
import type { Env } from '../../config/env.validation';
import type { ProfileService } from '../users/profile.service';
import type { ObjectStoragePort } from './ports/object-storage.port';
import { ProfilePhotoService } from './profile-photo.service';

const USER_ID = 'u-1';
const OTHER_USER = 'u-2';
const MAX_BYTES = 5_242_880;
const TTL = 300;
/** A real JPEG starts FF D8 FF; anything else is not a JPEG. */
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22]);

const auth: AuthContext = {
  userId: USER_ID,
  organizationId: 7,
  sessionId: 's-1',
  persona: 'attendee',
};

function config(): ConfigService<Env, true> {
  return {
    getOrThrow: (key: string) => (key === 'UPLOAD_MAX_BYTES' ? MAX_BYTES : TTL),
  } as unknown as ConfigService<Env, true>;
}

describe('ProfilePhotoService (US-DISC-11)', () => {
  let storage: jest.Mocked<ObjectStoragePort>;
  let profile: jest.Mocked<ProfileService>;
  let service: ProfilePhotoService;

  beforeEach(() => {
    storage = {
      presignPut: jest.fn().mockResolvedValue({
        uploadUrl: 'https://bucket.test/signed',
        headers: { 'content-type': 'image/jpeg', 'content-length': '1024' },
        expiresInSeconds: TTL,
      }),
      head: jest
        .fn()
        .mockResolvedValue({ contentType: 'image/jpeg', byteSize: 1024 }),
      readPrefix: jest.fn().mockResolvedValue(JPEG_BYTES),
      copy: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
      publicUrl: jest.fn((key: string) => `https://cdn.test/${key}`),
      keyFromPublicUrl: jest.fn((url: string) =>
        url.startsWith('https://cdn.test/')
          ? url.slice('https://cdn.test/'.length)
          : null,
      ),
    };
    profile = {
      setAvatarUrl: jest
        .fn()
        .mockResolvedValue({ avatarUrl: 'https://cdn.test/x' }),
      get: jest.fn().mockResolvedValue({ avatarUrl: null }),
    } as unknown as jest.Mocked<ProfileService>;
    service = new ProfilePhotoService(storage, profile, config());
  });

  const request = (o: Record<string, unknown> = {}) =>
    service.requestUpload(auth, {
      contentType: 'image/jpeg',
      byteSize: 1024,
      ...o,
    });

  describe('requestUpload', () => {
    it('issues a key under the CALLER’s own staging prefix', async () => {
      const result = await request();
      expect(result.key.startsWith(`uploads/${USER_ID}/`)).toBe(true);
      expect(result.uploadUrl).toBe('https://bucket.test/signed');
    });

    it('gives each upload its own key, so a retry cannot clobber the last one', async () => {
      const first = await request();
      const second = await request();
      expect(first.key).not.toBe(second.key);
    });

    it('names the file by its real type, not by anything the client says', async () => {
      const result = await request({ contentType: 'image/png' });
      expect(result.key.endsWith('.png')).toBe(true);
    });

    it('binds the exact size and type into the signature', async () => {
      await request({ byteSize: 2048 });
      expect(storage.presignPut).toHaveBeenCalledWith(
        expect.objectContaining({ contentType: 'image/jpeg', byteSize: 2048 }),
      );
    });

    it('refuses a type that is not an image we serve', async () => {
      await expect(
        request({ contentType: 'application/pdf' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(storage.presignPut).not.toHaveBeenCalled();
    });

    it('refuses an oversized upload BEFORE handing out a URL', async () => {
      await expect(request({ byteSize: MAX_BYTES + 1 })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(storage.presignPut).not.toHaveBeenCalled();
    });

    it('refuses an empty upload', async () => {
      await expect(request({ byteSize: 0 })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });
  });

  describe('confirm', () => {
    const key = `uploads/${USER_ID}/photo.jpg`;
    const finalKey = `avatars/${USER_ID}/photo.jpg`;

    it('checks the BYTES, copies to a key nobody can PUT to, and saves that URL', async () => {
      const result = await service.confirm(auth, { key });
      expect(storage.readPrefix).toHaveBeenCalledWith(key, 12);
      expect(storage.copy).toHaveBeenCalledWith({
        from: key,
        to: finalKey,
        contentType: 'image/jpeg',
      });
      // The staging object goes, so the still-valid upload URL points at nothing.
      expect(storage.remove).toHaveBeenCalledWith(key);
      expect(profile.setAvatarUrl).toHaveBeenCalledWith(
        auth,
        `https://cdn.test/${finalKey}`,
      );
      expect(result.avatarUrl).toBe(`https://cdn.test/${finalKey}`);
    });

    it('rejects bytes that are not the image type they claim to be', async () => {
      // <html>… uploaded with content-type image/jpeg: the signed PUT allows it,
      // and the STORED type is the client's own claim, so only bytes catch it.
      storage.readPrefix.mockResolvedValue(
        new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]),
      );
      await expect(service.confirm(auth, { key })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(storage.remove).toHaveBeenCalledWith(key);
      expect(storage.copy).not.toHaveBeenCalled();
      expect(profile.setAvatarUrl).not.toHaveBeenCalled();
    });

    it('rejects an object whose bytes are too few to identify', async () => {
      storage.readPrefix.mockResolvedValue(new Uint8Array([0xff]));
      await expect(service.confirm(auth, { key })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(storage.copy).not.toHaveBeenCalled();
    });

    it('refuses a key belonging to someone else — 403, nothing saved', async () => {
      const err = await service
        .confirm(auth, { key: `uploads/${OTHER_USER}/photo.jpg` })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(403);
      expect(storage.head).not.toHaveBeenCalled();
      expect(profile.setAvatarUrl).not.toHaveBeenCalled();
    });

    it('refuses a key that escapes the prefix by traversal', async () => {
      await expect(
        service.confirm(auth, { key: `uploads/${USER_ID}/../../secrets/key` }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(storage.head).not.toHaveBeenCalled();
    });

    it('refuses a final-prefix key — only staging keys are ever issued', async () => {
      await expect(
        service.confirm(auth, { key: `avatars/${USER_ID}/photo.jpg` }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('refuses to confirm an upload that never happened', async () => {
      storage.head.mockResolvedValue(null);
      await expect(service.confirm(auth, { key })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(profile.setAvatarUrl).not.toHaveBeenCalled();
    });

    it('rejects AND deletes an object whose declared type is not an image', async () => {
      storage.head.mockResolvedValue({
        contentType: 'text/html',
        byteSize: 1024,
      });
      await expect(service.confirm(auth, { key })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(storage.remove).toHaveBeenCalledWith(key);
      expect(profile.setAvatarUrl).not.toHaveBeenCalled();
    });

    it('rejects AND deletes an object that landed oversized', async () => {
      storage.head.mockResolvedValue({
        contentType: 'image/jpeg',
        byteSize: MAX_BYTES + 1,
      });
      await expect(service.confirm(auth, { key })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(storage.remove).toHaveBeenCalledWith(key);
    });
  });

  describe('remove', () => {
    it('deletes the photo the profile ACTUALLY shows, not one the caller names', async () => {
      const live = `avatars/${USER_ID}/current.jpg`;
      profile.get.mockResolvedValue({
        avatarUrl: `https://cdn.test/${live}`,
      } as never);
      await service.remove(auth);
      expect(profile.setAvatarUrl).toHaveBeenCalledWith(auth, null);
      expect(storage.remove).toHaveBeenCalledWith(live);
    });

    it('does nothing when there is no photo', async () => {
      profile.get.mockResolvedValue({ avatarUrl: null } as never);
      await service.remove(auth);
      expect(profile.setAvatarUrl).not.toHaveBeenCalled();
      expect(storage.remove).not.toHaveBeenCalled();
    });

    it('still clears a URL that is not ours, rather than leaving it stuck', async () => {
      profile.get.mockResolvedValue({
        avatarUrl: 'https://elsewhere.test/old.png',
      } as never);
      await service.remove(auth);
      expect(profile.setAvatarUrl).toHaveBeenCalledWith(auth, null);
      expect(storage.remove).not.toHaveBeenCalled();
    });
  });
});
