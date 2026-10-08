import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { SkipResponseEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { CSV_MIME, toCsv } from '../../common/csv/csv';
import { deliveriesCsv } from './deliveries-csv';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ApiList, ApiPage } from '../../common/http/api-data.decorator';
import type { Paginated } from '../../common/http/paginated';
import type { AuthContext } from '../auth/auth.types';
import { DeliveryDto } from './dto/delivery.dto';
import { DeliveriesQueryDto } from './dto/deliveries.query.dto';
import type { DeliveryRow } from './message-deliveries.repository';
import { MessageDeliveriesService } from './message-deliveries.service';

/**
 * The delivery log (US-MSG-06).
 *
 * Read-only: nothing here re-sends. Gated on `regView`, the same permission as
 * the attendee list — every row names a person and their address.
 */
@ApiTags('message-deliveries')
@ApiBearerAuth()
@UseGuards(AdminGuard, PermissionsGuard)
@RequirePermissions(Permission.regView)
@ApiForbiddenResponse({
  type: ApiErrorDto,
  description: 'Every row names an attendee and their address.',
})
@Controller('message-deliveries')
export class MessageDeliveriesController {
  constructor(private readonly deliveries: MessageDeliveriesService) {}

  @Get()
  @ResponseMessage('Deliveries retrieved.')
  @ApiPage(DeliveryDto)
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: DeliveriesQueryDto,
  ): Promise<Paginated<DeliveryRow>> {
    return this.deliveries.list(auth, query);
  }

  /**
   * The log as a file (US-MSG-07), under whatever filters are in the query —
   * so what downloads is what was on screen.
   */
  @Get('export.csv')
  @SkipResponseEnvelope()
  @Header('Content-Type', CSV_MIME)
  @Header('Content-Disposition', 'attachment; filename="delivery-log.csv"')
  async exportCsv(
    @CurrentAuth() auth: AuthContext,
    @Query() query: DeliveriesQueryDto,
  ): Promise<string> {
    const table = deliveriesCsv(await this.deliveries.forExport(auth, query));
    return toCsv(table.headers, table.rows);
  }

  /**
   * The kinds this workspace has actually sent — the filter offers what is
   * there rather than the whole catalog, so it never lists a message type
   * nobody in this workspace has ever received.
   */
  @Get('kinds')
  @ResponseMessage('Message kinds retrieved.')
  @ApiList(String)
  kinds(@CurrentAuth() auth: AuthContext): Promise<string[]> {
    return this.deliveries.kinds(auth);
  }
}
