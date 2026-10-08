import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module';
import { UsersModule } from '../users/users.module';
import { ProfilePhotoController } from './profile-photo.controller';
import { ProfilePhotoService } from './profile-photo.service';

/**
 * Profile photo (US-DISC-11): issue a short-lived presigned upload, verify what
 * landed, and set it on the profile through `ProfileService` — this module owns
 * no tables.
 *
 * `ObjectStoragePort` comes from `UploadsModule`, which is the single place it
 * is bound. Binding it here as well gave the app two adapters for one bucket.
 */
@Module({
  imports: [UploadsModule, UsersModule],
  controllers: [ProfilePhotoController],
  providers: [ProfilePhotoService],
})
export class ProfilePhotoModule {}
