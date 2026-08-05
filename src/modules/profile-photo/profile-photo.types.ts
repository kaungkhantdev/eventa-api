/**
 * The image types a profile photo may be: the extension each is stored as, and
 * the leading bytes a real file of that type must begin with.
 *
 * A `Map`, not an object literal — `'constructor' in {}` is true, so an object
 * allow-list checked with `in` accepts every `Object.prototype` key.
 */
interface ImageType {
  extension: string;
  /** Byte signature, with `null` for positions that vary (RIFF size field). */
  magic: readonly (number | null)[];
}

export const ALLOWED_IMAGE_TYPES: ReadonlyMap<string, ImageType> = new Map([
  ['image/jpeg', { extension: 'jpg', magic: [0xff, 0xd8, 0xff] }],
  [
    'image/png',
    {
      extension: 'png',
      magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    },
  ],
  [
    'image/webp',
    {
      // "RIFF" ???? "WEBP" — the four size bytes are the file's own length.
      extension: 'webp',
      magic: [
        0x52,
        0x49,
        0x46,
        0x46,
        null,
        null,
        null,
        null,
        0x57,
        0x45,
        0x42,
        0x50,
      ],
    },
  ],
]);

export const ALLOWED_CONTENT_TYPES = [...ALLOWED_IMAGE_TYPES.keys()];

/** Enough bytes to cover the longest signature above. */
export const MAGIC_BYTES_TO_READ = 12;

/**
 * Uploads land here first. The final key is never presigned, so nobody can
 * replace the bytes after they have been checked.
 */
export const STAGING_PREFIX = 'uploads';
export const PHOTO_PREFIX = 'avatars';

export function stagingPrefixFor(userId: string): string {
  return `${STAGING_PREFIX}/${userId}/`;
}

export function photoPrefixFor(userId: string): string {
  return `${PHOTO_PREFIX}/${userId}/`;
}

/** True when `bytes` actually begins with this content type's signature. */
export function looksLike(contentType: string, bytes: Uint8Array): boolean {
  const magic = ALLOWED_IMAGE_TYPES.get(contentType)?.magic;
  if (!magic) return false;
  if (bytes.length < magic.length) return false;
  return magic.every((byte, i) => byte === null || bytes[i] === byte);
}
