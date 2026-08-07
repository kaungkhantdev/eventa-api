import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ApiData } from '../../common/http/api-data.decorator';
import type { AuthContext } from '../auth/auth.types';
import { CheckInService } from './check-in.service';
import { toScanResult } from './check-in.mapper';
import {
  ManualCheckInDto,
  ScanResultDto,
  ScanTicketDto,
} from './dto/check-in.dto';

/**
 * The check-in station (US-REG-11/12/13). Every route needs `regCheckin` —
 * the story's note is explicit that watching the door and working it are
 * different privileges, and Staff hold this one by default.
 *
 * A 409 here means the STATION cannot operate (the door is shut); a refused
 * ticket comes back 200 with an `outcome`, because the person at the door needs
 * to know which of five things went wrong.
 */
@ApiTags('check-in')
@ApiBearerAuth()
@Controller('events/:eventId/check-ins')
@UseGuards(AdminGuard, PermissionsGuard)
export class CheckInController {
  constructor(private readonly checkIn: CheckInService) {}

  @Post('scan')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.regCheckin)
  @ResponseMessage('Scan processed.')
  @ApiData(ScanResultDto)
  @ApiConflictResponse({
    description: 'Check-in is not open for this event',
    type: ApiErrorDto,
  })
  async scan(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: ScanTicketDto,
  ): Promise<ScanResultDto> {
    return toScanResult(await this.checkIn.scan(auth, eventId, { ...dto }));
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.regCheckin)
  @ResponseMessage('Attendee checked in.')
  @ApiData(ScanResultDto)
  async admit(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: ManualCheckInDto,
  ): Promise<ScanResultDto> {
    return toScanResult(
      await this.checkIn.admitManually(auth, eventId, { ...dto }),
    );
  }

  @Delete(':ticketId')
  @RequirePermissions(Permission.regCheckin)
  @ResponseMessage('Check-in undone.')
  undo(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ): Promise<void> {
    return this.checkIn.undo(auth, eventId, ticketId);
  }
}
