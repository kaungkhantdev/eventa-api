import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { ApiData, ApiPage } from '../../common/http/api-data.decorator';
import type { MemberStatusCounts } from './access.types';
import { Paginated } from '../../common/http/paginated';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AccessService } from './access.service';
import { InviteMemberDto } from './dto/invite-member.dto';
import { InviteResponseDto } from './dto/invite-response.dto';
import { ListMembersQueryDto } from './dto/list-members.query.dto';
import { MemberResponseDto } from './dto/member-response.dto';
import { UpdateMemberDto } from './dto/update-member.dto';

/** Team members — list and assign roles (part of RBAC administration). */
@ApiTags('access')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Requires setUsers', type: ApiErrorDto })
@UseGuards(PermissionsGuard)
@Controller('members')
export class MembersController {
  constructor(private readonly access: AccessService) {}

  @Get()
  @RequirePermissions(Permission.setUsers)
  @ResponseMessage('Members retrieved.')
  @ApiPage(MemberResponseDto)
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListMembersQueryDto,
  ): Promise<Paginated<MemberResponseDto>> {
    return this.access.listMembers(auth.organizationId, query);
  }

  /**
   * How many members sit behind each tab. Its own call rather than a field on
   * the list, because the list is one page and these describe all of them.
   */
  @Get('counts')
  @RequirePermissions(Permission.setUsers)
  @ResponseMessage('Member counts retrieved.')
  @ApiData(Object)
  counts(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListMembersQueryDto,
  ): Promise<MemberStatusCounts> {
    return this.access.countMembers(auth.organizationId, query);
  }

  @Post()
  @RequirePermissions(Permission.setUsers)
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Teammate invited.')
  @ApiData(InviteResponseDto, HttpStatus.CREATED)
  invite(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: InviteMemberDto,
  ): Promise<InviteResponseDto> {
    return this.access.inviteMember(auth.organizationId, {
      name: dto.name,
      email: dto.email,
      roleId: dto.roleId,
    });
  }

  @Patch(':id')
  @RequirePermissions(Permission.setUsers)
  @ResponseMessage('Member role updated.')
  @ApiData(MemberResponseDto)
  changeRole(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMemberDto,
  ): Promise<MemberResponseDto> {
    return this.access.changeMemberRole(auth.organizationId, id, dto.roleId);
  }

  @Post(':id/suspend')
  @RequirePermissions(Permission.setUsers)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Member suspended.')
  @ApiData(MemberResponseDto)
  suspend(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<MemberResponseDto> {
    return this.access.suspendMember(auth.organizationId, id);
  }

  @Post(':id/reactivate')
  @RequirePermissions(Permission.setUsers)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Member reactivated.')
  @ApiData(MemberResponseDto)
  reactivate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<MemberResponseDto> {
    return this.access.reactivateMember(auth.organizationId, id);
  }

  @Delete(':id')
  @RequirePermissions(Permission.setUsers)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Member removed.')
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.access.removeMember(auth.organizationId, id);
  }
}
