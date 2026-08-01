import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiData } from '../../common/http/api-data.decorator';
import type { AuthContext } from '../auth/auth.types';
import { ChangeEmailDto } from './dto/change-email.dto';
import { ConfirmEmailDto } from './dto/confirm-email.dto';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './profile.service';

/**
 * Settings → My profile (US-SET-01). Every route acts on the CALLER's own record
 * — the id comes from the token, never the path, so a member can't edit anyone
 * else here (that's Team administration).
 */
@ApiTags('profile')
@Controller('me')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get('profile')
  @ApiBearerAuth()
  @ResponseMessage('Profile retrieved.')
  @ApiData(ProfileResponseDto)
  get(@CurrentAuth() auth: AuthContext): Promise<ProfileResponseDto> {
    return this.profile.get(auth);
  }

  @Patch('profile')
  @ApiBearerAuth()
  @ResponseMessage('Profile updated.')
  @ApiData(ProfileResponseDto)
  update(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    return this.profile.update(auth, dto);
  }

  @Post('profile/email')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.ACCEPTED)
  @ResponseMessage('Check your new inbox to confirm the change.')
  @ApiData(ProfileResponseDto, HttpStatus.ACCEPTED)
  changeEmail(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: ChangeEmailDto,
  ): Promise<ProfileResponseDto> {
    return this.profile.requestEmailChange(auth, dto.email);
  }

  @Public()
  @Post('profile/email/confirm')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Email confirmed.')
  @ApiData(ProfileResponseDto)
  confirmEmail(@Body() dto: ConfirmEmailDto): Promise<ProfileResponseDto> {
    return this.profile.confirmEmailChange(dto.token);
  }
}
