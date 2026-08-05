/** What the service needs to issue an upload URL (validated at the edge). */
export interface RequestPhotoUploadInput {
  contentType: string;
  byteSize: number;
}

/** What the service needs to confirm or remove an upload. */
export interface ConfirmPhotoInput {
  key: string;
}
