import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ApiPage } from '../../common/http/api-data.decorator';
import type { Paginated } from '../../common/http/paginated';
import type { AuthContext } from '../auth/auth.types';
import {
  ListRegistrationsDto,
  RegistrationCountsDto,
  RegistrationEntryDto,
} from './dto/registrations.dto';
import { RegistrationsService } from './registrations.service';

/**
 * The registrations queue (US-REG-01). `regView` — reviewing sign-ups is a
 * different privilege from deciding them (`regManage`) or working the door
 * (`regCheckin`), and money is masked separately again by `finView`.
 */
@ApiTags('registrations')
@ApiBearerAuth()
@Controller('registrations')
@UseGuards(AdminGuard, PermissionsGuard)
export class RegistrationsController {
  constructor(private readonly registrations: RegistrationsService) {}

  @Get()
  @RequirePermissions(Permission.regView)
  @ResponseMessage('Registrations retrieved.')
  @ApiPage(RegistrationEntryDto, 200, { counts: RegistrationCountsDto })
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListRegistrationsDto,
  ): Promise<Paginated<RegistrationEntryDto>> {
    const { page, counts } = await this.registrations.list(auth, { ...query });
    return page.withMeta({ counts });
  }
}
