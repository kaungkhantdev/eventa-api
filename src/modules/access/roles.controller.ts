import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { ApiData, ApiList } from '../../common/http/api-data.decorator';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RolesService } from './roles.service';
import { PermissionResponseDto } from './dto/permission-response.dto';
import { RoleResponseDto } from './dto/role-response.dto';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';

/** RBAC administration — the permission catalog, roles, and grant/revoke. */
@ApiTags('access')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Requires setUsers', type: ApiErrorDto })
@UseGuards(PermissionsGuard)
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequirePermissions(Permission.setUsers)
  @ResponseMessage('Permissions retrieved.')
  @ApiList(PermissionResponseDto)
  listPermissions(): Promise<PermissionResponseDto[]> {
    return this.roles.listPermissions();
  }

  @Get('roles')
  @RequirePermissions(Permission.setUsers)
  @ResponseMessage('Roles retrieved.')
  @ApiList(RoleResponseDto)
  listRoles(@CurrentAuth() auth: AuthContext): Promise<RoleResponseDto[]> {
    return this.roles.listRoles(auth.organizationId);
  }

  @Put('roles/:id/permissions')
  @RequirePermissions(Permission.setUsers)
  @ResponseMessage('Role permissions updated.')
  @ApiData(RoleResponseDto)
  updateRolePermissions(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRolePermissionsDto,
  ): Promise<RoleResponseDto> {
    return this.roles.setRolePermissions(
      auth.organizationId,
      id,
      dto.permissions,
    );
  }
}
