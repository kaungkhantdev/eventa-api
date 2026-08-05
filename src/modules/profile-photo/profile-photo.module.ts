import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';
import { UsersModule } from '../users/users.module';
import { ObjectStoragePort } from './ports/object-storage.port';
import { ProfilePhotoController } from './profile-photo.controller';
import { ProfilePhotoService } from './profile-photo.service';
import { MemoryObjectStorageAdapter } from './providers/memory-object-storage.adapter';
import { S3ObjectStorageAdapter } from './providers/s3-object-storage.adapter';

/**
 * Profile photo (US-DISC-11): issue a short-lived presigned upload, verify what
 * landed, and set it on the profile through `ProfileService` — this module owns
 * no tables. Storage sits behind `ObjectStoragePort`, chosen by
 * `STORAGE_PROVIDER` and defaulting to the in-memory double so the app runs
 * without AWS credentials; `s3` needs a bucket and region, which the env schema
 * enforces at boot.
 */
@Module({
  imports: [UsersModule],
  controllers: [ProfilePhotoController],
  providers: [
    ProfilePhotoService,
    {
      provide: ObjectStoragePort,
      useFactory: (config: ConfigService<Env, true>) =>
        config.getOrThrow('STORAGE_PROVIDER', { infer: true }) === 's3'
          ? new S3ObjectStorageAdapter(config)
          : new MemoryObjectStorageAdapter(config),
      inject: [ConfigService],
    },
  ],
})
export class ProfilePhotoModule {}
