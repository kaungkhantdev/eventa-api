import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
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
  constructor(private readonly organization: OrganizationService) {}

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
}
