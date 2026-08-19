import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
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
import { ApiData, ApiPage } from '../../common/http/api-data.decorator';
import { Paginated } from '../../common/http/paginated';
import type { AuthContext } from '../auth/auth.types';
import { CheckInService } from './check-in.service';
import { toAttendanceRow, toScanResult } from './check-in.mapper';
import {
  AttendanceCountsDto,
  AttendanceRowDto,
  DEFAULT_LIMIT,
  ListAttendanceDto,
} from './dto/attendance.dto';
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

  /**
   * The roll (US-REG-11): who is expected, and who is already inside.
   *
   * One endpoint for both screens the door uses. The queue reads it by name;
   * the station's live feed reads `?status=checked_in&sort=recent`. They are
   * two views of one list, and two endpoints would drift apart.
   *
   * Unlike the write routes this does NOT require the door to be open —
   * checking the list before doors open, and reconciling it after they close,
   * are the moments it is most wanted.
   */
  @Get()
  @RequirePermissions(Permission.regCheckin)
  @ResponseMessage('Attendance retrieved.')
  @ApiPage(AttendanceRowDto, 200, { counts: AttendanceCountsDto })
  async list(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query() query: ListAttendanceDto,
  ): Promise<Paginated<AttendanceRowDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const { rows, total, counts } = await this.checkIn.listAttendance(
      auth,
      eventId,
      {
        page,
        limit,
        status: query.status,
        search: query.search,
        sort: query.sort ?? 'name',
      },
    );
    return Paginated.of(rows.map(toAttendanceRow), total, page, limit).withMeta(
      {
        counts,
      },
    );
  }

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
