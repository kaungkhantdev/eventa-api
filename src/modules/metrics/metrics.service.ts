import { Injectable, Logger } from '@nestjs/common';
import { Gauge, Registry, collectDefaultMetrics } from 'prom-client';
import { OutboxLagRepository } from './outbox-lag.repository';

const PREFIX = 'eventa_';

/**
 * What the API tells Prometheus.
 *
 * The two outbox gauges are the point. Everything else about this service can
 * be inferred from HTTP traffic; the backlog cannot, because a stalled relay
 * produces no errors anywhere — orders succeed, responses are 200, and the only
 * evidence is a table quietly filling up.
 *
 * Both are collected at SCRAPE time rather than on a timer. Prometheus decides
 * how often it wants the number, and a background interval would either query
 * more often than anyone reads it or hold a value stale enough to alert on
 * wrongly.
 */
@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  readonly registry = new Registry();

  constructor(private readonly outbox: OutboxLagRepository) {
    collectDefaultMetrics({ register: this.registry, prefix: PREFIX });

    new Gauge({
      name: `${PREFIX}outbox_lag_seconds`,
      help: 'Age of the oldest unpublished outbox row, in seconds',
      registers: [this.registry],
      collect: async function (this: Gauge) {
        this.set(await backlogOf('oldestAgeSeconds'));
      },
    });

    new Gauge({
      name: `${PREFIX}outbox_unpublished`,
      help: 'Outbox rows written but not yet published',
      registers: [this.registry],
      collect: async function (this: Gauge) {
        this.set(await backlogOf('unpublished'));
      },
    });

    const backlogOf = async (
      field: 'oldestAgeSeconds' | 'unpublished',
    ): Promise<number> => {
      try {
        return (await this.outbox.backlog())[field];
      } catch (err) {
        // A scrape must never take the endpoint down with it: Prometheus would
        // read the whole target as unreachable and lose every other series in
        // the same response. -1 is outside any real value, so a dashboard shows
        // "cannot measure" rather than a reassuring zero.
        this.logger.warn({ err }, 'Could not read outbox backlog for metrics');
        return -1;
      }
    };
  }

  scrape(): Promise<string> {
    return this.registry.metrics();
  }
}
