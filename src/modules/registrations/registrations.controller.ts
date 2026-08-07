import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ApiData, ApiPage } from '../../common/http/api-data.decorator';
import type { Paginated } from '../../common/http/paginated';
import type { AuthContext } from '../auth/auth.types';
import {
  AddRegistrationDto,
  AddedRegistrationDto,
} from './dto/add-registration.dto';
import {
  DecisionOutcomeDto,
  RejectRegistrationDto,
} from './dto/registration-decision.dto';
import { RegistrationEntryService } from './registration-entry.service';
import {
  ListRegistrationsDto,
  RegistrationCountsDto,
  RegistrationEntryDto,
} from './dto/registrations.dto';
import { RegistrationDecisionsService } from './registration-decisions.service';
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
  constructor(
    private readonly registrations: RegistrationsService,
    private readonly decisions: RegistrationDecisionsService,
    private readonly entry: RegistrationEntryService,
  ) {}

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

  /** A walk-up or phone booking the organizer enters themselves (US-REG-03). */
  @Post()
  @RequirePermissions(Permission.regManage)
  @ResponseMessage('Registration added.')
  @ApiData(AddedRegistrationDto, 201)
  add(
    @CurrentAuth() auth: AuthContext,
    @Body() body: AddRegistrationDto,
  ): Promise<AddedRegistrationDto> {
    return this.entry.add(auth, body);
  }

  /**
   * `regManage`, not `regView` — the note on US-REG-02 is explicit that Staff
   * may work the queue but not decide it.
   */
  @Post(':id/approve')
  @RequirePermissions(Permission.regManage)
  @ResponseMessage('Registration approved.')
  @ApiData(DecisionOutcomeDto)
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DecisionOutcomeDto> {
    return this.decisions.approve(auth, id);
  }

  @Post(':id/reject')
  @RequirePermissions(Permission.regManage)
  @ResponseMessage('Registration rejected.')
  @ApiData(DecisionOutcomeDto)
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RejectRegistrationDto,
  ): Promise<DecisionOutcomeDto> {
    return this.decisions.reject(auth, id, {
      confirm: body.confirm,
      reason: body.reason ?? null,
    });
  }
}
