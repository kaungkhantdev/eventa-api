import { Module } from '@nestjs/common';
import { ObjectStoragePort } from '../profile-photo/ports/object-storage.port';
import { S3ObjectStorageAdapter } from '../profile-photo/providers/s3-object-storage.adapter';
import { ImageUploadService } from './image-upload.service';

/**
 * Uploading an image, for anything that owns one — a profile photo, a workspace
 * logo, an event cover, and whatever comes next.
 *
 * The rules that make an upload safe live in `ImageUploadService` and exist
 * once, so a second consumer cannot re-derive the magic-byte check slightly
 * differently.
 *
 * This module is the ONLY place `ObjectStoragePort` is bound. It was bound
 * here and again in `ProfilePhotoModule`, which meant two adapters for one
 * bucket — harmless against S3, which is stateless, and a trap for any adapter
 * that is not. Consumers import this module and take the port from it.
 *
 * The binding is S3 outright: there is no second backend to choose between, and
 * local dev points `S3_ENDPOINT` at MinIO rather than swapping the adapter.
 *
 * The port and its adapter still live under `profile-photo/`, where they were
 * written. They belong here, and moving them is a mechanical change worth doing
 * on its own rather than folded into a feature.
 */
@Module({
  providers: [
    ImageUploadService,
    { provide: ObjectStoragePort, useClass: S3ObjectStorageAdapter },
  ],
  exports: [ImageUploadService, ObjectStoragePort],
})
export class UploadsModule {}
