import { Controller, Get, Header, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { SkipResponseEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ApiPage } from '../../common/http/api-data.decorator';
import { Paginated } from '../../common/http/paginated';
import type { AuthContext } from '../auth/auth.types';
import { AuditService } from './audit.service';
import { AuditEntryDto } from './dto/audit-entry.dto';
import { ListAuditQueryDto } from './dto/list-audit.query.dto';

/**
 * Settings → Security & access log (US-SET-05). Read-only by construction: there
 * is no route here that edits or deletes an entry. A member always sees their own
 * events; an Admin sees the whole workspace.
 *
 * `?subjectType=attendee&subjectId=<id>` is the same list narrowed to the
 * entries about one record — what the attendee profile's activity timeline asks
 * for (US-REG-08 AC5). It adds no reach: a filter is ANDed onto the caller's
 * existing scope, so a member without `setUsers` sees their own edits of that
 * attendee and nothing more. AC5 is still met for them, because the organizer
 * reopening the profile is the one who just made the edit.
 *
 * No existence check is made on the subject, deliberately — an unknown or
 * out-of-workspace id answers with an empty page rather than confirming whether
 * such a record exists.
 */
@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ResponseMessage('Audit log retrieved.')
  @ApiPage(AuditEntryDto)
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListAuditQueryDto,
  ): Promise<Paginated<AuditEntryDto>> {
    return this.audit.list(auth, query);
  }

  @Get('export')
  @SkipResponseEnvelope()
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListAuditQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, csv } = await this.audit.export(auth, query);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }
}
