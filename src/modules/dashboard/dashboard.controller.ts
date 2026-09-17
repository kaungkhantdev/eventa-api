import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ApiData } from '../../common/http/api-data.decorator';
import type { AuthContext } from '../auth/auth.types';
import { ProfileService } from '../users/profile.service';
import { DashboardAnalyticsService } from './dashboard-analytics.service';
import { DashboardHomeService } from './dashboard-home.service';
import { WorkspaceSetupService } from './workspace-setup.service';
import {
  AnalyticsDto,
  AnalyticsQueryDto,
  HomeDto,
  HomeQueryDto,
  WorkspaceSetupDto,
} from './dto/dashboard.dto';

/**
 * The operations home and the analytics dashboard (E11).
 *
 * `AdminGuard` alone: every panel is permission-gated INSIDE the services, per
 * panel, because a Staff member who may see sign-ups but not money must get the
 * page with the revenue section absent — not a 403 for the whole surface
 * (US-DASH-08/13). Attendees are refused outright by the guard (US-DASH-01).
 *
 * Both routes are pure reads. Nothing on this surface changes a record;
 * everything actionable is a link into the module that owns it.
 */
@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
@UseGuards(AdminGuard)
export class DashboardController {
  constructor(
    private readonly home: DashboardHomeService,
    private readonly analytics: DashboardAnalyticsService,
    private readonly profiles: ProfileService,
    private readonly setup: WorkspaceSetupService,
  ) {}

  /**
   * How far this workspace has been set up — the first-run checklist's source
   * of truth (US-DASH-01).
   *
   * `AdminGuard` only, like the rest of this controller: each step is gated
   * individually inside the service, so somebody who may create events but not
   * change settings gets the steps they can act on rather than a 403 for the
   * whole checklist.
   */
  @Get('setup')
  @ResponseMessage('Setup state loaded.')
  @ApiData(WorkspaceSetupDto)
  loadSetup(@CurrentAuth() auth: AuthContext): Promise<WorkspaceSetupDto> {
    return this.setup.load(auth);
  }

  @Get('home')
  @ResponseMessage('Home loaded.')
  @ApiData(HomeDto)
  async loadHome(
    @CurrentAuth() auth: AuthContext,
    @Query() query: HomeQueryDto,
  ): Promise<HomeDto> {
    // The greeting names the SIGNED-IN user, read server-side: the client is
    // never the source of who it is greeting. `name` only lets a caller supply
    // a preferred display name, and changes nothing about whose figures load.
    const name = query.name ?? (await this.profiles.get(auth)).name;
    return this.home.load(auth, name, query.language ?? 'en');
  }

  @Get()
  @ResponseMessage('Dashboard loaded.')
  @ApiData(AnalyticsDto)
  loadAnalytics(
    @CurrentAuth() auth: AuthContext,
    @Query() query: AnalyticsQueryDto,
  ): Promise<AnalyticsDto> {
    return this.analytics.load(auth, { range: query.range });
  }
}
