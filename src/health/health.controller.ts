import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { SkipResponseEnvelope } from '../common/decorators/skip-envelope.decorator';
import { HealthService } from './health.service';

/**
 * Kubernetes-style probes. Raw bodies (no `{ data }` envelope) so probe tooling
 * reads `status` directly.
 * - `GET /api/v1/health/live`  — liveness: the process is up (no dependencies).
 * - `GET /api/v1/health/ready` — readiness: dependencies reachable (503 if not).
 */
@Public()
@SkipResponseEnvelope()
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Process is alive' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOkResponse({ description: 'All dependencies reachable' })
  @ApiServiceUnavailableResponse({ description: 'A dependency is unavailable' })
  async ready(@Res({ passthrough: true }) res: Response) {
    const result = await this.health.readiness();
    res.status(
      result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE,
    );
    return result;
  }
}
