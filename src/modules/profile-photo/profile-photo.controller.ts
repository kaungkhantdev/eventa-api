import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { ApiData } from '../../common/http/api-data.decorator';
import type { AuthContext } from '../auth/auth.types';
import {
  ConfirmPhotoDto,
  RequestPhotoUploadDto,
} from './dto/request-photo-upload.dto';
import { PhotoDto, PhotoUploadDto } from './dto/photo-upload.dto';
import { ProfilePhotoService } from './profile-photo.service';

/**
 * Settings → profile photo (US-DISC-11). Two steps, because the bytes never
 * pass through this API: ask for a URL, PUT the file to it, then confirm. Every
 * route acts on the CALLER's own photo — the key is issued from the token's
 * user id, never taken from the path.
 */
@ApiTags('profile')
@Controller('me/photo')
export class ProfilePhotoController {
  constructor(private readonly photos: ProfilePhotoService) {}

  @Post('upload-url')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ResponseMessage('Upload URL issued.')
  @ApiData(PhotoUploadDto)
  requestUpload(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: RequestPhotoUploadDto,
  ): Promise<PhotoUploadDto> {
    return this.photos.requestUpload(auth, dto);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ResponseMessage('Photo updated.')
  @ApiData(PhotoDto)
  @ApiForbiddenResponse({
    description: 'The key was not issued to this account',
    type: ApiErrorDto,
  })
  confirm(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: ConfirmPhotoDto,
  ): Promise<PhotoDto> {
    return this.photos.confirm(auth, dto);
  }

  /** No key in the request: the photo actually on the profile is the one removed. */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  remove(@CurrentAuth() auth: AuthContext): Promise<void> {
    return this.photos.remove(auth);
  }
}
