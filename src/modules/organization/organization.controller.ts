import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ApiData } from '../../common/http/api-data.decorator';
import type { AuthContext } from '../auth/auth.types';
import { OrganizationResponseDto } from './dto/organization-response.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import {
  ConfirmLogoDto,
  LogoDto,
  LogoUploadDto,
  RequestLogoUploadDto,
} from './dto/logo.dto';
import { OrganizationLogoService } from './organization-logo.service';
import { OrganizationService } from './organization.service';

/**
 * Settings → Organization (US-SET-07). Any signed-in member may READ the workspace
 * identity (it renders on branded surfaces); only `setSettings` may change it, so
 * an Organizer or Staff sees it read-only rather than being able to edit.
 */
@ApiTags('organization')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('organization')
export class OrganizationController {
  constructor(
    private readonly organization: OrganizationService,
    private readonly logo: OrganizationLogoService,
  ) {}

  @Get()
  @ResponseMessage('Organization retrieved.')
  @ApiData(OrganizationResponseDto)
  get(@CurrentAuth() auth: AuthContext): Promise<OrganizationResponseDto> {
    return this.organization.get(auth.organizationId);
  }

  @Patch()
  @RequirePermissions(Permission.setSettings)
  @ResponseMessage('Organization updated.')
  @ApiData(OrganizationResponseDto)
  @ApiForbiddenResponse({
    description: 'Requires setSettings',
    type: ApiErrorDto,
  })
  update(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: UpdateOrganizationDto,
  ): Promise<OrganizationResponseDto> {
    return this.organization.update(auth.organizationId, dto);
  }

  /**
   * Two steps, because the bytes never pass through this API: ask for a URL,
   * PUT the file to it, then confirm. The key is issued from the token's
   * organization, never taken from the path.
   */
  @Post('logo/upload-url')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.setSettings)
  @ResponseMessage('Upload URL issued.')
  @ApiData(LogoUploadDto)
  @ApiForbiddenResponse({
    description: 'Requires setSettings',
    type: ApiErrorDto,
  })
  requestLogoUpload(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: RequestLogoUploadDto,
  ): Promise<LogoUploadDto> {
    return this.logo.requestUpload(auth.organizationId, dto);
  }

  @Post('logo')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.setSettings)
  @ResponseMessage('Logo updated.')
  @ApiData(LogoDto)
  @ApiForbiddenResponse({
    description: 'Requires setSettings',
    type: ApiErrorDto,
  })
  confirmLogo(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: ConfirmLogoDto,
  ): Promise<LogoDto> {
    return this.logo.confirm(auth.organizationId, dto.key);
  }

  @Delete('logo')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permission.setSettings)
  @ApiForbiddenResponse({
    description: 'Requires setSettings',
    type: ApiErrorDto,
  })
  removeLogo(@CurrentAuth() auth: AuthContext): Promise<void> {
    return this.logo.remove(auth.organizationId);
  }
}
