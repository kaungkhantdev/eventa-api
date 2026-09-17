import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { validateEnv } from '../../config/env.validation';
import { ObjectStoragePort } from '../profile-photo/ports/object-storage.port';
import { S3ObjectStorageAdapter } from '../profile-photo/providers/s3-object-storage.adapter';
import { ImageUploadService } from './image-upload.service';
import { UploadsModule } from './uploads.module';

// The env this module needs to build, and nothing else. `??=`, so a value
// already in the shell still wins.
process.env.DATABASE_URL ??= 'postgres://u:p@localhost:5432/db';
process.env.JWT_SECRET ??= 'a-sufficiently-long-test-secret';
process.env.S3_BUCKET ??= 'eventa-test-no-such-bucket';
process.env.S3_REGION ??= 'ap-southeast-1';

/**
 * That the module actually WIRES UP — which nothing else here proves.
 *
 * Every other suite that touches an upload either builds the adapter with `new`
 * or replaces `ObjectStoragePort` with the in-process double, so none of them
 * ever asks Nest to construct the real one. A binding Nest cannot resolve
 * therefore passes the entire suite, passes `tsc`, and fails at boot — where
 * the person who finds it is whoever started the server.
 *
 * Not hypothetical: this file exists because `useClass` was exactly such a
 * binding. `S3ObjectStorageAdapter` takes an optional second parameter so its
 * own spec can pass a fake `S3Client`, and `emitDecoratorMetadata` emits that
 * parameter's type whether or not it is optional — so Nest went looking for an
 * `S3Client` provider, which nothing provides.
 */
describe('UploadsModule', () => {
  it('resolves the storage port to the real S3 adapter', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: validateEnv,
        }),
        UploadsModule,
      ],
    }).compile();

    expect(moduleRef.get(ObjectStoragePort)).toBeInstanceOf(
      S3ObjectStorageAdapter,
    );
    expect(moduleRef.get(ImageUploadService)).toBeInstanceOf(
      ImageUploadService,
    );
    await moduleRef.close();
  });
});
