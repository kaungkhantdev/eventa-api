import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SkipResponseEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { MetricsService } from './metrics.service';

/**
 * `GET /api/v1/metrics` — the Prometheus scrape endpoint.
 *
 * `@SkipResponseEnvelope` because the exposition format is the contract: a
 * scrape wrapped in `{ success, data }` parses as zero metrics, silently.
 *
 * `@Public` for the same reason the health probes are — a scraper carries no
 * session. In production this port is cluster-internal; if it is ever published,
 * it wants network policy in front of it rather than an auth guard, because
 * Prometheus does not hold a JWT.
 *
 * Excluded from the OpenAPI document: it is not part of the product's API, and
 * a generated client should not offer it.
 */
@Public()
@SkipResponseEnvelope()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @ApiExcludeEndpoint()
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  scrape(): Promise<string> {
    return this.metrics.scrape();
  }
}
