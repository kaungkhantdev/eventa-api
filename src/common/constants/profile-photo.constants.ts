/** The profile-photo module's named constants. */

/** Keys are issued by the server, but they still arrive as input on confirm. */
export const MAX_KEY_LENGTH = 200;

/** Enough bytes to cover the longest signature above. */
export const MAGIC_BYTES_TO_READ = 12;

/**
 * Uploads land here first. The final key is never presigned, so nobody can
 * replace the bytes after they have been checked.
 */
export const STAGING_PREFIX = 'uploads';

export const PHOTO_PREFIX = 'avatars';

/** S3's error name when the key simply is not there. */
export const NOT_FOUND = 'NotFound';

export const NOT_FOUND_STATUS = 404;
