import {
  Body,
  Controller,
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
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import { ApiErrorDto } from '../../../common/errors/error-envelope';
import { ApiData, ApiPage } from '../../../common/http/api-data.decorator';
import { Paginated } from '../../../common/http/paginated';
import type { AuthContext } from '../auth.types';
import { CurrentAuth } from '../decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../decorators/require-permissions.decorator';
import { PermissionsGuard } from '../guards/permissions.guard';
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
}
