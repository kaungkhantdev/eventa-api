/** What the browser needs to send the bytes itself, without them touching us. */
export interface PresignedUpload {
  uploadUrl: string;
  /** Exactly the headers the client MUST send — they are covered by the signature. */
  headers: Record<string, string>;
  expiresInSeconds: number;
}

/** What actually landed in the bucket. */
export interface StoredObject {
  contentType: string | null;
  byteSize: number | null;
}

export interface PresignPutInput {
  key: string;
  contentType: string;
  /** Signed into the URL, so the client cannot upload a different size. */
  byteSize: number;
}

/**
 * Object storage, behind an abstraction (DIP) — the same shape of seam as
 * `PaymentProviderPort`. Domain code must never import an AWS client directly;
 * it asks for a presigned URL, then asks what landed.
 *
 * One implementation ships: `S3ObjectStorageAdapter`, bound in `UploadsModule`.
 * Local development runs the same adapter against MinIO by setting
 * `S3_ENDPOINT` — a different bucket, not a different backend. The seam earns
 * its keep regardless: it keeps the SDK out of the services, and it is what
 * lets a test swap in `test/doubles/memory-object-storage.adapter.ts` without
 * the app carrying a second storage implementation into production.
 */
export interface CopyObjectInput {
  from: string;
  to: string;
  /** Written afresh on the copy, so no client-supplied header survives. */
  contentType: string;
}

export abstract class ObjectStoragePort {
  /** A short-lived URL the browser PUTs to directly. */
  abstract presignPut(input: PresignPutInput): Promise<PresignedUpload>;

  /** What is stored under `key`, or null when nothing is. */
  abstract head(key: string): Promise<StoredObject | null>;

  /**
   * The first `byteCount` bytes of the object — the only evidence of what was
   * actually uploaded. The stored content type is NOT evidence: S3 records
   * whatever the client declared on the PUT.
   */
  abstract readPrefix(
    key: string,
    byteCount: number,
  ): Promise<Uint8Array | null>;

  /**
   * Server-side copy to a key that was never presigned, rewriting the metadata.
   * This is what makes a checked upload immutable — and drops any unsigned
   * header (Content-Disposition, Content-Encoding) the client attached.
   */
  abstract copy(input: CopyObjectInput): Promise<void>;

  /** Best-effort removal; deleting an absent key is not an error. */
  abstract remove(key: string): Promise<void>;

  /** The address the object is served from once uploaded. */
  abstract publicUrl(key: string): string;

  /** The storage key an already-saved public URL refers to, if it is one of ours. */
  abstract keyFromPublicUrl(url: string): string | null;
}
