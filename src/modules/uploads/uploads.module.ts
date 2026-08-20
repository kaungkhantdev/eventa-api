import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';
import { ObjectStoragePort } from '../profile-photo/ports/object-storage.port';
import { MemoryObjectStorageAdapter } from '../profile-photo/providers/memory-object-storage.adapter';
import { S3ObjectStorageAdapter } from '../profile-photo/providers/s3-object-storage.adapter';
import { ImageUploadService } from './image-upload.service';

/**
 * Uploading an image, for anything that owns one — a profile photo, a workspace
 * logo, and whatever comes next.
 *
 * The rules that make an upload safe live in `ImageUploadService` and exist
 * once, so a second consumer cannot re-derive the magic-byte check slightly
 * differently. Storage sits behind `ObjectStoragePort`, chosen by
 * `STORAGE_PROVIDER` and defaulting to the in-memory double so the app runs
 * without cloud credentials; `s3` needs a bucket and region, which the env
 * schema enforces at boot.
 *
 * The port and its adapters still live under `profile-photo/`, where they were
 * written. They belong here, and moving them is a mechanical change worth doing
 * on its own rather than folded into a feature.
 */
@Module({
  providers: [
    ImageUploadService,
    {
      provide: ObjectStoragePort,
      useFactory: (config: ConfigService<Env, true>) =>
        config.getOrThrow('STORAGE_PROVIDER', { infer: true }) === 's3'
          ? new S3ObjectStorageAdapter(config)
          : new MemoryObjectStorageAdapter(config),
      inject: [ConfigService],
    },
  ],
  exports: [ImageUploadService, ObjectStoragePort],
})
export class UploadsModule {}
